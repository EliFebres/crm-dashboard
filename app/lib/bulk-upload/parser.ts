import ExcelJS from 'exceljs';
import { Readable } from 'stream';

export interface ParsedRow {
  rowNumber: number; // 1-based, row 1 = first data row (after header)
  crn: string | null; // External client CRN (resolved/registered server-side)
  externalClient: string | null;
  internalClientName: string;
  internalClientDept: string;
  intakeType: string;
  adHocChannel: string | null;
  type: string;
  teamMembers: string[];
  department: string;
  dateStarted: string; // ISO date string
  dateFinished: string | null; // ISO date string or null
  status: string;
  portfolioLogged: boolean;
  nna: number | null; // stored in dollars (input is in $M)
  notes: string | null;
  tickersMentioned: string[];
  portfolio: string | null; // JSON string of PortfolioHolding[] or null
  structuredNotes: string | null; // JSON string of note entries with metadata or null
}

export interface ParseResult {
  rows: ParsedRow[];
  parseErrors: { rowNumber: number; message: string }[];
}

// Normalize date values from Excel — handles JS Date objects, serial numbers, and strings
function parseDate(value: unknown): string | null {
  if (value == null || value === '') return null;

  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }

  const s = String(value).trim();
  if (!s || s === '—' || s.toLowerCase() === 'n/a') return null;

  // Try common date formats
  const formats = [
    /^(\d{4})-(\d{1,2})-(\d{1,2})$/,  // YYYY-MM-DD
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, // M/D/YYYY
    /^(\d{1,2})-(\d{1,2})-(\d{4})$/,   // M-D-YYYY
  ];

  for (const fmt of formats) {
    const m = s.match(fmt);
    if (m) {
      let year: number, month: number, day: number;
      if (fmt === formats[0]) {
        [, year, month, day] = m.map(Number) as [string, number, number, number];
      } else {
        [, month, day, year] = m.map(Number) as [string, number, number, number];
      }
      const d = new Date(Date.UTC(year, month - 1, day));
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
  }

  // Last resort: native parse
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);

  return null;
}

function str(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function parseBoolean(value: unknown): boolean {
  if (value == null || value === '') return false;
  const s = str(value).toLowerCase();
  return s === 'true' || s === 'yes' || s === '1';
}

function parseCommaSeparated(value: unknown): string[] {
  if (value == null || value === '') return [];
  return String(value)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

export async function parseUploadedFile(buffer: Buffer, filename: string): Promise<ParseResult> {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext !== 'xlsx' && ext !== 'csv') {
    throw new Error('Only .xlsx and .csv files are supported.');
  }

  const workbook = new ExcelJS.Workbook();

  if (ext === 'csv') {
    await workbook.csv.read(Readable.from(buffer));
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(buffer as any);
  }

  // Use the first worksheet that has data (skip reference sheets)
  const worksheet = workbook.worksheets.find(ws => ws.rowCount > 1) ?? workbook.worksheets[0];
  if (!worksheet) throw new Error('No worksheet found in the file.');

  const rows: ParsedRow[] = [];
  const parseErrors: { rowNumber: number; message: string }[] = [];

  // Find the header row (row 1 in the worksheet = header)
  // Data rows start at row 2
  const dataRows: ExcelJS.Row[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) dataRows.push(row);
  });

  dataRows.forEach((row, idx) => {
    const rowNumber = idx + 1; // 1-based data row number

    // Skip completely empty rows
    const cellValues = row.values as unknown[];
    const nonEmpty = cellValues.slice(1).filter(v => v != null && str(v) !== '');
    if (nonEmpty.length === 0) return;

    try {
      const get = (col: number) => row.getCell(col).value;

      const crn = str(get(1)) || null;
      const externalClient = str(get(2)) || null;
      const internalClientName = str(get(3));
      const internalClientDept = str(get(4));
      const intakeType = str(get(5));
      const adHocChannel = str(get(6)) || null;
      const type = str(get(7));
      const teamMembers = parseCommaSeparated(get(8));
      const dateStartedRaw = get(9);
      const dateFinishedRaw = get(10);
      const status = str(get(11));
      const nnaMRaw = get(12);
      const notes = str(get(13)) || null;
      const tickersMentioned = parseCommaSeparated(get(14));
      const portfolioLoggedRaw = get(15);
      const portfolioRaw = str(get(16)) || null;
      const structuredNotesRaw = str(get(17)) || null;

      const dateStarted = parseDate(dateStartedRaw);
      const dateFinished = parseDate(dateFinishedRaw);

      if (!dateStarted) {
        parseErrors.push({ rowNumber, message: 'Date Started is missing or unparseable.' });
        return;
      }

      // NNA: input is in $M, store in dollars
      let nna: number | null = null;
      if (nnaMRaw != null && str(nnaMRaw) !== '') {
        const n = Number(str(nnaMRaw).replace(/[,$]/g, ''));
        nna = isNaN(n) ? null : Math.round(n * 1_000_000);
      }

      rows.push({
        rowNumber,
        crn,
        externalClient,
        internalClientName,
        internalClientDept,
        intakeType,
        adHocChannel,
        type,
        teamMembers,
        department: internalClientDept, // derived from internal client dept
        dateStarted,
        dateFinished,
        status,
        portfolioLogged: parseBoolean(portfolioLoggedRaw),
        nna,
        notes,
        tickersMentioned,
        portfolio: portfolioRaw,
        structuredNotes: structuredNotesRaw,
      });
    } catch (e) {
      parseErrors.push({ rowNumber, message: `Unexpected parse error: ${e instanceof Error ? e.message : String(e)}` });
    }
  });

  return { rows, parseErrors };
}
