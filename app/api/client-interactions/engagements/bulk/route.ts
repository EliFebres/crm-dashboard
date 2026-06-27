export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { executeTransaction, hasDb } from '@/app/lib/db';
import { requireAuth, canModify, readOnlyError } from '@/app/lib/auth/require-auth';
import { parseUploadedFile } from '@/app/lib/bulk-upload/parser';
import { validateRows } from '@/app/lib/bulk-upload/validator';
import type { ParsedRow } from '@/app/lib/bulk-upload/parser';
import { emitEngagementChange } from '@/app/lib/events';
import { logActivity } from '@/app/lib/activity/log';

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

  // Validate
  const { errors, warnings, validRows } = validateRows(parseResult.rows);

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

  // Commit — insert all valid rows atomically
  try {
    await executeTransaction((tx) => {
      for (const row of validRows) {
        const result = tx.run(
          `INSERT INTO engagements (
            external_client, internal_client_name, internal_client_dept,
            intake_type, ad_hoc_channel, type, team_members, department,
            date_started, date_finished, status, portfolio_logged, portfolio,
            nna, notes, tickers_mentioned, team
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            row.externalClient ?? null,
            row.internalClientName,
            row.internalClientDept,
            row.intakeType,
            row.adHocChannel ?? null,
            row.type,
            JSON.stringify(row.teamMembers),
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
  }));
}
