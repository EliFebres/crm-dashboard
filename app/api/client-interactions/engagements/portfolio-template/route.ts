export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';

// GET /api/client-interactions/engagements/portfolio-template
// Returns a downloadable .xlsx template for the Client Portfolio form.
// Fill it in, select all data rows, copy, and paste directly into the form.
export async function GET() {
  const workbook = new ExcelJS.Workbook();

  // ── Data sheet ───────────────────────────────────────────────────────────────
  const data = workbook.addWorksheet('Portfolio');

  // 4 columns matching the paste format the form expects
  data.columns = [
    { header: 'Identifier',       key: 'identifier',      width: 20 },
    { header: 'Constituent Type', key: 'constituentType', width: 22 },
    { header: 'Asset Class',      key: 'assetClass',      width: 20 },
    { header: 'Weight (%)',       key: 'weight',          width: 12 },
  ];

  // Style header row — apply fill cell-by-cell so it stops at column D
  data.getRow(1).height = 20;
  ['A', 'B', 'C', 'D'].forEach(col => {
    const cell = data.getCell(`${col}1`);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    cell.alignment = { vertical: 'middle' };
  });

  // Dropdown validation for enum columns
  const addValidation = (col: string, formula: string) => {
    for (let i = 2; i <= 201; i++) {
      data.getCell(`${col}${i}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [formula],
        showErrorMessage: true,
        errorTitle: 'Invalid value',
        error: 'Please select from the dropdown list.',
      };
    }
  };

  addValidation('B', '"Portfolio,Morningstar-Fund,Security,Index"');
  addValidation('C', '"Equity,Fixed Income,Alternatives,Crypto,Fund of Funds,Multi-Asset,Cash"');

  // Example rows
  const examples: Record<string, unknown>[] = [
    { identifier: 'FMAC',  constituentType: 'Security',         assetClass: 'Equity',       weight: 30 },
    { identifier: 'FMCF',  constituentType: 'Security',         assetClass: 'Fixed Income', weight: 25 },
    { identifier: 'FMREX', constituentType: 'Security',         assetClass: 'Alternatives', weight: 15 },
    { identifier: 'VBTLX', constituentType: 'Morningstar-Fund', assetClass: 'Fixed Income', weight: 20 },
    { identifier: 'BTC',   constituentType: 'Security',         assetClass: 'Crypto',       weight: 10 },
  ];

  examples.forEach((ex, i) => {
    const row = data.addRow(ex);
    row.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: i % 2 === 0 ? 'FFF4F6F9' : 'FFFFFFFF' },
    };
    // Right-align weight column
    row.getCell(4).alignment = { horizontal: 'right' };
  });

  data.views = [{ state: 'frozen', ySplit: 1 }];

  // ── Reference sheet ──────────────────────────────────────────────────────────
  const ref = workbook.addWorksheet('Reference');
  ref.getColumn(1).width = 22;
  ref.getColumn(2).width = 55;

  const refHeader = ref.addRow(['Column', 'Notes']);
  refHeader.font = { bold: true };
  refHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7EF' } };

  const refData: [string, string][] = [
    ['Identifier',       'Ticker, ISIN, or CUSIP. Will be auto-uppercased.'],
    ['Constituent Type', 'Portfolio | Morningstar-Fund | Security | Index'],
    ['Asset Class',      'Equity | Fixed Income | Alternatives | Crypto | Fund of Funds | Multi-Asset | Cash'],
    ['Weight (%)',       'Enter as a percentage (e.g. 25 = 25%). Weights are auto-normalized to sum to 100%.'],
    ['', ''],
    ['How to use', 'Fill in your holdings, select all data rows (not the header), copy (Ctrl+C), then paste directly into the Client Portfolio form.'],
  ];

  refData.forEach(([col, note]) => ref.addRow([col, note]));

  // Serialize
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="client-portfolio-template.xlsx"',
      'Content-Length': buffer.length.toString(),
    },
  });
}
