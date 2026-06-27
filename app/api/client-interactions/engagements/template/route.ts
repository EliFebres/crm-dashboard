export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';

// GET /api/client-interactions/engagements/template
// Returns a downloadable .xlsx template for bulk engagement upload
export async function GET() {
  const workbook = new ExcelJS.Workbook();

  // ── Data sheet ─────────────────────────────────────────────────────────────
  const data = workbook.addWorksheet('Engagements');

  // Column order (17 cols — Department is auto-derived):
  // A  CRN
  // B  External Client
  // C  Internal Client Name
  // D  Internal Client Dept
  // E  Intake Type
  // F  Ad-Hoc Channel
  // G  Project Type
  // H  Team Members
  // I  Date Started
  // J  Date Finished
  // K  Status
  // L  NNA ($M)
  // M  Notes
  // N  Tickers Mentioned
  // O  Portfolio Logged
  // P  Portfolio
  // Q  Notes (JSON)
  // No `header` property here: header row is added manually below to prevent
  // ExcelJS from bleeding row-level styling beyond the last column.
  data.columns = [
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
  const headerRow = data.addRow([
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

  // Dropdown validation for enum columns
  const addValidation = (col: string, formula: string) => {
    for (let i = 2; i <= 1001; i++) {
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

  addValidation('D', '"IAG,Broker-Dealer,Institutional"');
  addValidation('E', '"IRQ,SERF,GCG Ad-Hoc"');
  addValidation('F', '"In-Person,Email,Teams"');
  addValidation('G', '"Meeting,Discovery Meeting,Data Request,PCR,Other"');
  addValidation('K', '"In Progress,Awaiting Meeting,Follow Up,Completed"');
  addValidation('O', '"Yes,No"');

  // Date format for date columns
  for (let i = 2; i <= 1001; i++) {
    data.getCell(`I${i}`).numFmt = 'yyyy-mm-dd';
    data.getCell(`J${i}`).numFmt = 'yyyy-mm-dd';
  }

  // Example rows
  const examples: Record<string, unknown>[] = [
    {
      crn: 'CRN-000001',
      externalClient: 'Acme Pension Fund',
      internalClientName: 'Sarah K.',
      internalClientDept: 'IAG',
      intakeType: 'IRQ',
      adHocChannel: '',
      type: 'Meeting',
      teamMembers: 'Eli F., Sarah K.',
      dateStarted: '2024-06-10',
      dateFinished: '2024-06-14',
      status: 'Completed',
      nna: 120,
      notes: 'Client requested equity exposure analysis.',
      tickersMentioned: '',
      portfolioLogged: 'Yes',
      portfolio: '[{"identifier":"FMAC","constituentType":"Security","assetClass":"Equity","weight":0.6},{"identifier":"FMCF","constituentType":"Security","assetClass":"Fixed Income","weight":0.4}]',
      structuredNotes: '[{"text":"Client requested equity exposure analysis.","author":"Sarah K.","authorId":"user_1","date":"2024-06-10T10:00:00Z"}]',
    },
    {
      crn: 'CRN-000002',
      externalClient: 'BlueStar Wealth',
      internalClientName: 'David L.',
      internalClientDept: 'Broker-Dealer',
      intakeType: 'SERF',
      adHocChannel: '',
      type: 'Data Request',
      teamMembers: 'David L.',
      dateStarted: '2024-09-03',
      dateFinished: '',
      status: 'In Progress',
      nna: '',
      notes: '',
      tickersMentioned: '',
      portfolioLogged: 'No',
      portfolio: '',
      structuredNotes: '',
    },
    {
      crn: 'CRN-000003',
      externalClient: 'Summit Capital Group',
      internalClientName: 'Chris B.',
      internalClientDept: 'Institutional',
      intakeType: 'GCG Ad-Hoc',
      adHocChannel: 'Teams',
      type: 'Meeting',
      teamMembers: 'Chris B., Amanda P.',
      dateStarted: '2024-11-18',
      dateFinished: '2024-11-18',
      status: 'Completed',
      nna: '',
      notes: 'Discussed firm core equity vs Vanguard.',
      tickersMentioned: 'FMAC, VTI',
      portfolioLogged: 'No',
      portfolio: '',
      structuredNotes: '[{"text":"Discussed firm core equity vs Vanguard.","author":"Chris B.","authorId":"user_2","date":"2024-11-18T14:30:00Z"}]',
    },
  ];

  examples.forEach((ex, i) => {
    const row = data.addRow(ex);
    row.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: i % 2 === 0 ? 'FFF4F6F9' : 'FFFFFFFF' },
    };
  });

  data.views = [{ state: 'frozen', ySplit: 1 }];

  // ── Reference sheet ─────────────────────────────────────────────────────────
  const ref = workbook.addWorksheet('Reference');
  ref.getColumn(1).width = 28;
  ref.getColumn(2).width = 55;

  const refHeader = ref.addRow(['Column', 'Valid Values / Notes']);
  refHeader.font = { bold: true };
  refHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7EF' } };

  const refData: [string, string][] = [
    ['CRN', 'Client Reference Number — the unique ID of the external client. Provide an existing CRN, or leave blank to look up/register by External Client name (auto-generate mode assigns one).'],
    ['External Client', 'Required. Name of the external client/fund. Used to register a new client when no CRN is given.'],
    ['Internal Client Name', 'Required. Name of the internal contact (e.g. "Sarah K.")'],
    ['Internal Client Dept', 'Required. IAG | Broker-Dealer | Institutional'],
    ['Intake Type', 'Required. IRQ | SERF | GCG Ad-Hoc'],
    ['Ad-Hoc Channel', 'Required only for GCG Ad-Hoc rows. In-Person | Email | Teams'],
    ['Project Type', 'Required. Meeting | Discovery Meeting | Data Request | PCR | Other'],
    ['Team Members', 'Optional. Comma-separated names, e.g. "Eli F., Sarah K."'],
    ['Date Started', 'Required. Format: YYYY-MM-DD or M/D/YYYY'],
    ['Date Finished', 'Leave blank for In Progress / Awaiting rows.'],
    ['Status', 'Required. In Progress | Awaiting Meeting | Follow Up | Completed'],
    ['NNA ($M)', 'Optional. Net New Assets in millions. "120" = $120M.'],
    ['Notes', 'Optional. Human-readable notes text.'],
    ['Tickers Mentioned', 'Optional. Comma-separated tickers (GCG Ad-Hoc). E.g. "FMAC, VTI"'],
    ['Portfolio Logged', 'Yes or No. Whether a client portfolio was logged for this engagement.'],
    ['Portfolio', 'Optional. JSON array of holdings. Format: [{"identifier":"FMAC","constituentType":"Security","assetClass":"Equity","weight":0.35}]'],
    ['Notes (JSON)', 'Optional. JSON array of notes with metadata. Format: [{"text":"...","author":"Eli F.","authorId":"user_1","date":"2024-06-10T10:00:00Z"}]'],
    ['', ''],
    ['Auto-filled by system', 'Department (from Internal Client Dept)'],
    ['Backup/restore', 'Columns N-P are populated by the Export button for full backup. On import, Notes (JSON) takes priority over Notes for restoring individual note entries.'],
  ];

  refData.forEach(([col, note]) => ref.addRow([col, note]));

  // Serialize
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="engagement-bulk-upload-template.xlsx"',
      'Content-Length': buffer.length.toString(),
    },
  });
}
