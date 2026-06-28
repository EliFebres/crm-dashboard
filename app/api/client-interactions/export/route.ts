export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { query } from '@/app/lib/db';
import { buildFilterClause, resolveOfficeMembers, CLIENT_JOIN } from '@/app/lib/db/queries';
import { requireAuth, teamConstraint } from '@/app/lib/auth/require-auth';
import type { EngagementFilters } from '@/app/lib/api/client-interactions';
import { logActivity } from '@/app/lib/activity/log';

// GET /api/client-interactions/export
// Same query params as the engagements list route (no pagination — exports all matching rows)
// Returns an .xlsx file in the same 16-column format as the bulk upload template
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const sc = teamConstraint(auth.payload);

  try {
    const sp = req.nextUrl.searchParams;
    // Export always returns rows ordered by date_started DESC, regardless of
    // the table's UI sort — so no sortBy parsing here.
    const filters: EngagementFilters = {
      period: sp.get('period') || undefined,
      search: sp.get('search') || undefined,
      teamMember: sp.get('team_member') || undefined,
      status: sp.get('status') || undefined,
      departments: sp.getAll('departments').filter(Boolean),
      intakeTypes: sp.getAll('intake_types').filter(Boolean),
      projectTypes: sp.getAll('project_types').filter(Boolean),
    };

    const resolved = await resolveOfficeMembers(filters);
    const { whereClause, params } = buildFilterClause(resolved, 'e', sc);
    const EXPORT_ROW_LIMIT = 10_000;
    const rows = await query<Record<string, unknown>>(
      `SELECT e.*, c.crn AS client_crn, c.name AS client_name,
         (SELECT string_agg(n.note_text, ' | ' ORDER BY n.created_at ASC)
          FROM engagement_notes n
          WHERE n.engagement_id = e.id) AS notes_agg
       FROM engagements e ${CLIENT_JOIN} ${whereClause} ORDER BY e.date_started DESC LIMIT ${EXPORT_ROW_LIMIT}`,
      params
    );

    // Fetch structured notes for all exported engagements
    const engagementIds = rows.map(r => Number(r.id));
    const notesMap = new Map<number, object[]>();
    if (engagementIds.length > 0) {
      const noteRows = await query<Record<string, unknown>>(
        `SELECT engagement_id, note_text, author_name, author_id, created_at
         FROM engagement_notes
         WHERE engagement_id IN (${engagementIds.map(() => '?').join(',')})
         ORDER BY created_at ASC`,
        engagementIds
      );
      for (const nr of noteRows) {
        const eid = Number(nr.engagement_id);
        if (!notesMap.has(eid)) notesMap.set(eid, []);
        notesMap.get(eid)!.push({
          text: nr.note_text as string,
          author: nr.author_name as string,
          authorId: nr.author_id as string,
          date: String(nr.created_at),
        });
      }
    }

    const buffer = await buildXlsx(rows, notesMap);

    void logActivity(req, {
      action: 'engagement.export',
      entityType: 'engagement',
      details: { rowCount: rows.length, filters },
    });

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="engagements-export-${new Date().toISOString().split('T')[0]}.xlsx"`,
        'Content-Length': buffer.length.toString(),
      },
    });
  } catch (err) {
    console.error('GET /api/client-interactions/export error:', err);
    return new NextResponse('Failed to export engagements', { status: 500 });
  }
}

async function buildXlsx(rows: Record<string, unknown>[], notesMap: Map<number, object[]>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Engagements');

  // 17 columns — same order and keys as the bulk upload template
  // No `header` property here: header row is added manually below to prevent
  // ExcelJS from bleeding row-level styling beyond the last column.
  sheet.columns = [
    { key: 'crn',                width: 16 },
    { key: 'externalClient',     width: 24 },
    { key: 'internalClientName', width: 24 },
    { key: 'internalClientDept', width: 22 },
    { key: 'intakeType',          width: 16 },
    { key: 'adHocChannel',        width: 16 },
    { key: 'type',                width: 16 },
    { key: 'teamMembers',         width: 30 },
    { key: 'dateStarted',         width: 14 },
    { key: 'dateFinished',        width: 14 },
    { key: 'status',              width: 14 },
    { key: 'nna',                 width: 12 },
    { key: 'notes',               width: 40 },
    { key: 'tickersMentioned',    width: 30 },
    { key: 'portfolioLogged',     width: 16 },
    { key: 'portfolio',           width: 50 },
    { key: 'structuredNotes',     width: 50 },
  ];

  // Add header row manually and style only the populated cells.
  // eachCell({ includeEmpty: false }) ensures nothing beyond the last column is touched.
  const headerRow = sheet.addRow([
    'CRN', 'External Client', 'Internal Client Name', 'Internal Client Dept',
    'Intake Type', 'Ad-Hoc Channel', 'Project Type', 'Team Members',
    'Date Started', 'Date Finished', 'Status', 'NNA ($M)', 'Notes', 'Tickers Mentioned',
    'Portfolio Logged', 'Portfolio', 'Notes (JSON)',
  ]);
  headerRow.height = 20;
  headerRow.eachCell({ includeEmpty: false }, cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    cell.alignment = { vertical: 'middle' };
  });

  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  // Map raw DB rows directly (avoids display-format date conversion)
  for (const row of rows) {
    const teamMembers = JSON.parse((row.team_members as string) || '[]') as string[];
    const tickers = JSON.parse((row.tickers_mentioned as string) || '[]') as string[];
    const nnaRaw = row.nna as number | null;

    const engagementId = Number(row.id);
    const structuredNotes = notesMap.get(engagementId);

    sheet.addRow({
      crn:                (row.client_crn as string) || '',
      externalClient:     (row.client_name as string) || '',
      internalClientName: row.internal_client_name as string,
      internalClientDept: row.internal_client_dept as string,
      intakeType:         row.intake_type as string,
      adHocChannel:       (row.ad_hoc_channel as string) || '',
      type:               row.type as string,
      teamMembers:        teamMembers.join(', '),
      dateStarted:        row.date_started as string,
      dateFinished:       (row.date_finished as string) || '',
      status:             row.status as string,
      nna:                nnaRaw != null ? nnaRaw / 1_000_000 : '',
      notes:              (row.notes_agg as string) || (row.notes as string) || '',
      tickersMentioned:   tickers.join(', '),
      portfolioLogged:    Boolean(row.portfolio_logged) ? 'Yes' : 'No',
      portfolio:          (row.portfolio as string) || '',
      structuredNotes:    structuredNotes ? JSON.stringify(structuredNotes) : '',
    });
  }

  // ── Engagements (Formatted) sheet — human-readable, no JSON ──────────────
  const fmt = workbook.addWorksheet('Engagements (Formatted)');

  fmt.columns = [
    { key: 'crn',                width: 16 },
    { key: 'externalClient',     width: 24 },
    { key: 'internalClientName', width: 24 },
    { key: 'internalClientDept', width: 22 },
    { key: 'intakeType',          width: 16 },
    { key: 'adHocChannel',        width: 16 },
    { key: 'type',                width: 16 },
    { key: 'teamMembers',         width: 30 },
    { key: 'dateStarted',         width: 18 },
    { key: 'dateFinished',        width: 18 },
    { key: 'status',              width: 14 },
    { key: 'nna',                 width: 14 },
    { key: 'portfolioLogged',     width: 16 },
    { key: 'portfolio',           width: 40 },
    { key: 'notes',               width: 50 },
    { key: 'tickersMentioned',    width: 30 },
  ];

  const fmtHeader = fmt.addRow([
    'CRN', 'External Client', 'Internal Client Name', 'Department',
    'Intake Type', 'Ad-Hoc Channel', 'Project Type', 'Team Members',
    'Date Started', 'Date Finished', 'Status', 'NNA ($M)',
    'Portfolio Logged', 'Portfolio Holdings', 'Notes', 'Tickers Mentioned',
  ]);
  fmtHeader.height = 20;
  fmtHeader.eachCell({ includeEmpty: false }, cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    cell.alignment = { vertical: 'middle' };
  });

  fmt.views = [{ state: 'frozen', ySplit: 1 }];

  for (const row of rows) {
    const teamMembers = JSON.parse((row.team_members as string) || '[]') as string[];
    const tickers = JSON.parse((row.tickers_mentioned as string) || '[]') as string[];
    const nnaRaw = row.nna as number | null;
    // Format portfolio holdings as readable text: "FMAC (Equity, 35%), FMCF (Fixed Income, 40%)"
    let portfolioText = '';
    if (row.portfolio) {
      try {
        const holdings = JSON.parse(row.portfolio as string) as { identifier: string; assetClass: string; weight: number }[];
        portfolioText = holdings
          .map(h => `${h.identifier} (${h.assetClass}, ${Math.round(h.weight * 100)}%)`)
          .join(', ');
      } catch { /* leave empty */ }
    }

    const notesText = (row.notes_agg as string) || (row.notes as string) || '';

    fmt.addRow({
      crn:                (row.client_crn as string) || '',
      externalClient:     (row.client_name as string) || '',
      internalClientName: row.internal_client_name as string,
      internalClientDept: row.internal_client_dept as string,
      intakeType:         row.intake_type as string,
      adHocChannel:       (row.ad_hoc_channel as string) || '',
      type:               row.type as string,
      teamMembers:        teamMembers.join(', '),
      dateStarted:        formatDate(row.date_started as string),
      dateFinished:       row.date_finished ? formatDate(row.date_finished as string) : '',
      status:             row.status as string,
      nna:                nnaRaw != null ? `$${(nnaRaw / 1_000_000).toFixed(1)}M` : '',
      portfolioLogged:    Boolean(row.portfolio_logged) ? 'Yes' : 'No',
      portfolio:          portfolioText,
      notes:              notesText,
      tickersMentioned:   tickers.join(', '),
    });
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

// Format ISO date or timestamp to readable "Mon DD, YYYY" format
function formatDate(value: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
