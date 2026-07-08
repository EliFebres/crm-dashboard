export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { query, hasDb } from '@/app/lib/db';
import { requireAuth } from '@/app/lib/auth/require-auth';
import { logActivity } from '@/app/lib/activity/log';
import type { PortfolioHolding } from '@/app/lib/types/engagements';

// GET /api/client-interactions/clients/models/export
// Exports every client's model portfolios as a two-sheet .xlsx:
//   - "Models"   — one row per model (holdings collapsed to readable text)
//   - "Holdings" — one row per holding (exploded, for pivot-table analysis)
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  try {
    // Mock fallback (no DB): return an empty but valid workbook so the download
    // still succeeds, matching the models GET route's empty-set behavior.
    const rows = hasDb()
      ? await query<ModelExportRow>(
          `SELECT c.crn AS crn, c.name AS client_name,
                  m.id AS id, m.name AS name, m.is_main AS is_main, m.aum AS aum,
                  m.holdings AS holdings, m.sort_order AS sort_order,
                  m.created_at AS created_at, m.updated_at AS updated_at
             FROM client_models m
             JOIN clients c ON c.crn = m.crn
            ORDER BY c.name COLLATE NOCASE, m.sort_order, m.name COLLATE NOCASE`
        )
      : [];

    const buffer = await buildXlsx(rows);

    void logActivity(req, {
      action: 'clientModel.export',
      entityType: 'client',
      details: { rowCount: rows.length },
    });

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="client-models-export-${new Date().toISOString().split('T')[0]}.xlsx"`,
        'Content-Length': buffer.length.toString(),
      },
    });
  } catch (err) {
    console.error('GET /api/client-interactions/clients/models/export error:', err);
    return new NextResponse('Failed to export client models', { status: 500 });
  }
}

interface ModelExportRow {
  crn: string;
  client_name: string;
  id: string;
  name: string;
  is_main: number;
  aum: number | null;
  holdings: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// Safe-parse the holdings JSON column into a PortfolioHolding[] (mirrors the
// parseHoldings helper in app/lib/db/clientModels.ts).
function parseHoldings(raw: unknown): PortfolioHolding[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PortfolioHolding[]) : [];
  } catch {
    return [];
  }
}

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } } as const;

function styleHeader(row: ExcelJS.Row): void {
  row.height = 20;
  row.eachCell({ includeEmpty: false }, cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { ...HEADER_FILL };
    cell.alignment = { vertical: 'middle' };
  });
}

async function buildXlsx(rows: ModelExportRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  // ── Sheet 1: Models — one row per model ──────────────────────────────────
  const models = workbook.addWorksheet('Models');
  models.columns = [
    { key: 'crn',           width: 16 },
    { key: 'client',        width: 28 },
    { key: 'model',         width: 24 },
    { key: 'isMain',        width: 8 },
    { key: 'aum',           width: 12 },
    { key: 'holdingsCount', width: 12 },
    { key: 'holdings',      width: 60 },
    { key: 'createdAt',     width: 18 },
    { key: 'updatedAt',     width: 18 },
  ];
  styleHeader(models.addRow([
    'CRN', 'Client', 'Model', 'Main?', 'AUM', '# Holdings', 'Holdings', 'Created', 'Updated',
  ]));

  // ── Sheet 2: Holdings — one row per exploded holding ─────────────────────
  const holdingsSheet = workbook.addWorksheet('Holdings');
  holdingsSheet.columns = [
    { key: 'crn',        width: 16 },
    { key: 'client',     width: 28 },
    { key: 'model',      width: 24 },
    { key: 'identifier', width: 18 },
    { key: 'type',       width: 18 },
    { key: 'assetClass', width: 18 },
    { key: 'weight',     width: 12 },
  ];
  styleHeader(holdingsSheet.addRow([
    'CRN', 'Client', 'Model', 'Identifier', 'Constituent Type', 'Asset Class', 'Weight %',
  ]));

  for (const row of rows) {
    const holdings = parseHoldings(row.holdings);
    const aum = row.aum;

    models.addRow({
      crn:           row.crn,
      client:        row.client_name,
      model:         row.name,
      isMain:        row.is_main ? 'Yes' : 'No',
      aum:           aum != null ? `$${(aum / 1_000_000).toFixed(1)}M` : '',
      holdingsCount: holdings.length,
      holdings:      holdings
        .map(h => `${h.identifier} (${h.assetClass}, ${Math.round(h.weight * 100)}%)`)
        .join(', '),
      createdAt:     formatDate(row.created_at),
      updatedAt:     formatDate(row.updated_at),
    });

    for (const h of holdings) {
      holdingsSheet.addRow({
        crn:        row.crn,
        client:     row.client_name,
        model:      row.name,
        identifier: h.identifier,
        type:       h.constituentType,
        assetClass: h.assetClass,
        weight:     `${(h.weight * 100).toFixed(1)}%`,
      });
    }
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

// Format ISO date or timestamp to readable "Mon DD, YYYY" format.
function formatDate(value: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
