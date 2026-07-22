export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { query, executeTransaction, hasDb } from '@/app/lib/db';
import { requireAuth, canModify, readOnlyError } from '@/app/lib/auth/require-auth';
import { parseUploadedFile } from '@/app/lib/bulk-upload/parser';
import { validateRows } from '@/app/lib/bulk-upload/validator';
import { listDepartmentNames } from '@/app/lib/db/departments';
import { listIntakeTypeNames, intakeNameForRole } from '@/app/lib/db/intakeTypes';
import { listProjectTypeNames } from '@/app/lib/db/projectTypes';
import type { ParsedRow } from '@/app/lib/bulk-upload/parser';
import { crnConfig, normalizeCrn, generateNextCrn } from '@/app/lib/config/crn';
import { normalizeProjectId } from '@/app/lib/utils/text';
import { emitEngagementChange } from '@/app/lib/events';
import { logActivity } from '@/app/lib/activity/log';
import { getUserOffice } from '@/app/lib/db/users';

// POST /api/client-interactions/engagements/bulk
// Query: ?commit=true to actually insert (otherwise returns preview/errors only)
// Body: multipart/form-data with a "file" field (.xlsx or .csv)
export async function POST(req: NextRequest) {
  if (!hasDb()) {
    return NextResponse.json(
      { error: 'Database not configured. Set SQLITE_DIR to enable write operations.' },
      { status: 503 }
    );
  }
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!canModify(auth.payload)) return readOnlyError();

  const commit = req.nextUrl.searchParams.get('commit') === 'true';

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Request must be multipart/form-data.' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided. Include a "file" field in the form data.' }, { status: 400 });
  }

  const filename = file.name ?? 'upload.xlsx';
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext !== 'xlsx' && ext !== 'csv') {
    return NextResponse.json({ error: 'Only .xlsx and .csv files are supported.' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Parse
  let parseResult;
  try {
    parseResult = await parseUploadedFile(buffer, filename);
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to parse file: ${e instanceof Error ? e.message : String(e)}` },
      { status: 400 }
    );
  }

  if (parseResult.parseErrors.length > 0 && parseResult.rows.length === 0) {
    return NextResponse.json({ parseErrors: parseResult.parseErrors, errors: [], warnings: [], preview: [] }, { status: 422 });
  }

  // Validate — against the live managed department / intake-type / project-type lists
  const [validDepartments, validIntakeTypes, validProjectTypes, adHocIntakeName] = await Promise.all([
    listDepartmentNames(),
    listIntakeTypeNames(),
    listProjectTypeNames(),
    intakeNameForRole('ad_hoc'),
  ]);
  const { errors, warnings, validRows } = validateRows(
    parseResult.rows, validDepartments, validIntakeTypes, validProjectTypes, adHocIntakeName
  );

  if (errors.length > 0) {
    // Return all errors so the user can fix and re-upload
    return NextResponse.json(
      {
        parseErrors: parseResult.parseErrors,
        errors,
        warnings,
        preview: buildPreview(validRows),
        invalidCount: errors.length,
        validCount: validRows.length,
      },
      { status: 422 }
    );
  }

  // Resolve every row to a client CRN before previewing/committing. A row either
  // names an existing CRN/client, or (auto mode) registers a new one. Surface any
  // unresolvable rows as errors so the user can fix and re-upload.
  const { autoGenerate } = crnConfig();
  const existingClients = await query<{ crn: string; name: string }>(`SELECT crn, name FROM clients`);
  const crnSet = new Set(existingClients.map(c => c.crn));
  const nameLowerToCrn = new Map(existingClients.map(c => [c.name.toLowerCase(), c.crn]));
  const crnErrors: { rowNumber: number; field: string; message: string }[] = [];

  for (const row of validRows) {
    const crn = row.crn ? normalizeCrn(row.crn) : '';
    const name = (row.externalClient ?? '').trim();
    const nameLower = name.toLowerCase();
    if (crn) {
      if (crnSet.has(crn)) continue;
      if (!name) {
        crnErrors.push({ rowNumber: row.rowNumber, field: 'CRN', message: 'A new CRN requires an External Client name.' });
        continue;
      }
      const nameOwner = nameLowerToCrn.get(nameLower);
      if (nameOwner && nameOwner !== crn) {
        crnErrors.push({ rowNumber: row.rowNumber, field: 'CRN', message: `"${name}" is already registered under a different CRN.` });
        continue;
      }
      crnSet.add(crn);
      nameLowerToCrn.set(nameLower, crn);
    } else {
      if (nameLowerToCrn.has(nameLower)) continue;
      if (!autoGenerate) {
        crnErrors.push({ rowNumber: row.rowNumber, field: 'CRN', message: `No CRN provided and "${name}" is not a registered client.` });
        continue;
      }
      // Auto mode: a CRN will be generated at commit; reserve the name for the batch.
      nameLowerToCrn.set(nameLower, '<<auto>>');
    }
  }

  if (crnErrors.length > 0) {
    return NextResponse.json(
      {
        parseErrors: parseResult.parseErrors,
        errors: crnErrors,
        warnings,
        preview: buildPreview(validRows),
        invalidCount: crnErrors.length,
        validCount: validRows.length - crnErrors.length,
      },
      { status: 422 }
    );
  }

  if (!commit) {
    // Preview mode — return parsed data without inserting
    return NextResponse.json({
      parseErrors: parseResult.parseErrors,
      errors: [],
      warnings,
      preview: buildPreview(validRows),
      validCount: validRows.length,
    });
  }

  // Commit — insert all valid rows atomically. Resolved before the transaction
  // opens: executeTransaction's callback is synchronous.
  const office = await getUserOffice(auth.payload.sub);

  try {
    await executeTransaction((tx) => {
      const creatorId = auth.payload.sub;
      const creatorName = `${auth.payload.firstName} ${auth.payload.lastName}`;
      const batchNameToCrn = new Map<string, string>();

      // Resolve a row to a client CRN, registering a new client when needed.
      const resolveCrn = (row: ParsedRow): string => {
        const name = (row.externalClient ?? '').trim();
        const nameLower = name.toLowerCase();
        let crn = row.crn ? normalizeCrn(row.crn) : '';
        if (crn) {
          const exists = tx.get(`SELECT 1 FROM clients WHERE crn = ?`, [crn]);
          if (!exists) {
            tx.run(
              `INSERT INTO clients (crn, name, created_by_id, created_by_name) VALUES (?, ?, ?, ?)`,
              [crn, name, creatorId, creatorName]
            );
          }
          return crn;
        }
        if (batchNameToCrn.has(nameLower)) return batchNameToCrn.get(nameLower)!;
        const byName = tx.get<{ crn: string }>(`SELECT crn FROM clients WHERE name = ? COLLATE NOCASE`, [name]);
        if (byName) {
          batchNameToCrn.set(nameLower, byName.crn);
          return byName.crn;
        }
        crn = generateNextCrn(tx);
        tx.run(
          `INSERT INTO clients (crn, name, created_by_id, created_by_name) VALUES (?, ?, ?, ?)`,
          [crn, name, creatorId, creatorName]
        );
        batchNameToCrn.set(nameLower, crn);
        return crn;
      };

      for (const row of validRows) {
        const clientCrn = resolveCrn(row);
        const result = tx.run(
          `INSERT INTO engagements (
            client_crn, internal_client_name, internal_client_dept,
            intake_type, ad_hoc_channel, type, team_members, office, department,
            date_started, date_finished, status, portfolio_logged, portfolio,
            nna, notes, tickers_mentioned, team, project_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            clientCrn,
            row.internalClientName,
            row.internalClientDept,
            row.intakeType,
            row.adHocChannel ?? null,
            row.type,
            JSON.stringify(row.teamMembers),
            office,
            row.department,
            row.dateStarted,
            row.dateFinished ?? null,
            row.status,
            row.portfolioLogged,
            row.portfolio ?? null,
            row.nna ?? null,
            row.structuredNotes ? null : (row.notes ?? null),
            row.tickersMentioned.length > 0 ? JSON.stringify(row.tickersMentioned) : null,
            auth.payload.team,
            normalizeProjectId(row.projectId),
          ]
        );
        const id = Number(result.lastInsertRowid);

        // Insert structured notes into engagement_notes table if present
        if (row.structuredNotes) {
          const notes = JSON.parse(row.structuredNotes) as { text: string; author: string; authorId?: string; date?: string }[];
          for (const note of notes) {
            tx.run(
              `INSERT INTO engagement_notes (engagement_id, note_text, author_name, author_id, created_at)
               VALUES (?, ?, ?, ?, ?)`,
              [
                id,
                note.text,
                note.author,
                note.authorId ?? 'bulk-import',
                note.date ?? new Date().toISOString(),
              ]
            );
          }
        }
      }
    });

    emitEngagementChange('created');
    void logActivity(req, {
      action: 'engagement.bulk_upload',
      entityType: 'engagement',
      details: { inserted: validRows.length, filename },
    });
    return NextResponse.json({ inserted: validRows.length, warnings }, { status: 201 });
  } catch (err) {
    console.error('Bulk insert error:', err);
    return NextResponse.json({ error: 'Import failed. No rows were saved.' }, { status: 500 });
  }
}

function buildPreview(rows: ParsedRow[]) {
  return rows.map(row => ({
    rowNumber: row.rowNumber,
    crn: row.crn,
    externalClient: row.externalClient,
    internalClientName: row.internalClientName,
    internalClientDept: row.internalClientDept,
    intakeType: row.intakeType,
    adHocChannel: row.adHocChannel,
    type: row.type,
    teamMembers: row.teamMembers,
    department: row.department,
    dateStarted: row.dateStarted,
    dateFinished: row.dateFinished,
    status: row.status,
    portfolioLogged: row.portfolioLogged,
    nna: row.nna,
    notes: row.notes,
    portfolio: row.portfolio,
    structuredNotes: row.structuredNotes,
    projectId: row.projectId,
  }));
}
