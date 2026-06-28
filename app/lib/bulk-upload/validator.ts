import type { ParsedRow } from './parser';
import { VALID_STATUSES as STATUS_ENUM } from '../statusHelpers';
import { normalizeCrn, isValidCrn } from '../config/crn';

export interface ValidationError {
  rowNumber: number;
  field: string;
  message: string;
}

export interface ValidationWarning {
  rowNumber: number;
  field: string;
  message: string;
}

export interface ValidationResult {
  errors: ValidationError[];
  warnings: ValidationWarning[];
  validRows: ParsedRow[];
}

const VALID_INTAKE_TYPES = ['IRQ', 'SERF', 'GCG Ad-Hoc'];
const VALID_AD_HOC_CHANNELS = ['In-Person', 'Email', 'Teams'];
const VALID_PROJECT_TYPES = ['Meeting', 'Discovery Meeting', 'Data Request', 'Data Update', 'PCR', 'Other', 'Follow-up Material', 'Follow-up Meeting'];
const VALID_DEPARTMENTS = ['IAG', 'Broker-Dealer', 'Institutional', 'Retirement Group'];
const VALID_STATUSES: string[] = [...STATUS_ENUM];
const VALID_INTERNAL_CLIENT_DEPTS = ['IAG', 'Broker-Dealer', 'Institutional', 'Retirement Group'];
const VALID_CONSTITUENT_TYPES = ['Portfolio', 'Morningstar-Fund', 'Security', 'Index'];
const VALID_ASSET_CLASSES = ['Equity', 'Fixed Income', 'Alternatives', 'Crypto', 'Fund of Funds'];

// Fuzzy normalize for enum matching — case-insensitive, strip spaces/hyphens
function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s-_]/g, '');
}

function matchEnum(value: string, options: string[]): string | null {
  const norm = normalize(value);
  return options.find(o => normalize(o) === norm) ?? null;
}

// Alias maps for intake type normalization
const INTAKE_TYPE_ALIASES: Record<string, string> = {
  'gcgadhoc': 'GCG Ad-Hoc',
  'adhoc': 'GCG Ad-Hoc',
  'ad-hoc': 'GCG Ad-Hoc',
  'gcg': 'GCG Ad-Hoc',
  'irq': 'IRQ',
  'serf': 'SERF',
  'srrf': 'SERF', // old name alias
  'grrf': 'SERF', // old name alias
};

function normalizeIntakeType(value: string): string | null {
  const norm = normalize(value);
  if (INTAKE_TYPE_ALIASES[norm]) return INTAKE_TYPE_ALIASES[norm];
  return matchEnum(value, VALID_INTAKE_TYPES);
}

// Alias map for ad-hoc channel
const CHANNEL_ALIASES: Record<string, string> = {
  'inperson': 'In-Person',
  'in-person': 'In-Person',
  'email': 'Email',
  'teams': 'Teams',
  'msteams': 'Teams',
  'microsoftteams': 'Teams',
};

function normalizeChannel(value: string): string | null {
  const norm = normalize(value);
  if (CHANNEL_ALIASES[norm]) return CHANNEL_ALIASES[norm];
  return matchEnum(value, VALID_AD_HOC_CHANNELS);
}

// Alias map for status
const STATUS_ALIASES: Record<string, string> = {
  'inprogress': 'In Progress',
  'in-progress': 'In Progress',
  'active': 'In Progress',
  'open': 'In Progress',
  'completed': 'Completed',
  'done': 'Completed',
  'finished': 'Completed',
  'closed': 'Completed',
  'pending': 'Awaiting Meeting',
  'waiting': 'Awaiting Meeting',
  'awaitingmeeting': 'Awaiting Meeting',
  'followup': 'Follow Up',
  'follow-up': 'Follow Up',

};

function normalizeStatus(value: string): string | null {
  const norm = normalize(value);
  if (STATUS_ALIASES[norm]) return STATUS_ALIASES[norm];
  return matchEnum(value, VALID_STATUSES);
}

// Alias map for departments
const DEPT_ALIASES: Record<string, string> = {
  'iag': 'IAG',
  'institutionalassetgrowth': 'IAG',
  'brokdealer': 'Broker-Dealer',
  'bd': 'Broker-Dealer',
  'brokerdealer': 'Broker-Dealer',
  'institution': 'Institutional',
  'institutional': 'Institutional',
  'retirementgroup': 'Retirement Group',
  'rg': 'Retirement Group',
  'retirement': 'Retirement Group',
};

function normalizeDept(value: string): string | null {
  const norm = normalize(value);
  if (DEPT_ALIASES[norm]) return DEPT_ALIASES[norm];
  return matchEnum(value, VALID_DEPARTMENTS);
}

function normalizeProjectType(value: string): string | null {
  const norm = normalize(value);
  // Common aliases
  const aliases: Record<string, string> = {
    'meeting': 'Meeting',
    'discoverymeet': 'Discovery Meeting',
    'discoverym': 'Discovery Meeting',
    'discovery': 'Discovery Meeting',
    'datarequest': 'Data Request',
    'data': 'Data Request',
    'dataupdate': 'Data Update',
    'pcr': 'PCR',
    'other': 'Other',
    'followupmaterial': 'Follow-up Material',
    'followupmaterials': 'Follow-up Material',
    'followupmat': 'Follow-up Material',
    'fumaterial': 'Follow-up Material',
    'followupmeeting': 'Follow-up Meeting',
    'followupmtg': 'Follow-up Meeting',
    'fumeeting': 'Follow-up Meeting',
  };
  if (aliases[norm]) return aliases[norm];
  return matchEnum(value, VALID_PROJECT_TYPES);
}

export function validateRows(rows: ParsedRow[]): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const validRows: ParsedRow[] = [];

  for (const row of rows) {
    const rowErrors: ValidationError[] = [];
    const rowWarnings: ValidationWarning[] = [];

    // Client identity: a row must carry a CRN or an External Client name (the
    // server resolves the name to an existing CRN, or registers a new client).
    // Uniqueness/existence is enforced server-side in the bulk route.
    const crnRaw = row.crn ? row.crn.trim() : '';
    if (crnRaw) {
      const norm = normalizeCrn(crnRaw);
      if (!isValidCrn(norm)) {
        rowErrors.push({ rowNumber: row.rowNumber, field: 'CRN', message: `"${crnRaw}" is not a valid CRN.` });
      } else {
        row.crn = norm;
      }
    } else if (!row.externalClient) {
      rowErrors.push({ rowNumber: row.rowNumber, field: 'CRN', message: 'Provide a CRN or an External Client name.' });
    }

    // Required: internalClientName
    if (!row.internalClientName) {
      rowErrors.push({ rowNumber: row.rowNumber, field: 'Internal Client Name', message: 'Required field is missing.' });
    }

    // Required: internalClientDept — normalize
    const normDept = normalizeDept(row.internalClientDept);
    if (!normDept) {
      rowErrors.push({
        rowNumber: row.rowNumber,
        field: 'Internal Client Dept',
        message: `"${row.internalClientDept}" is not valid. Use: ${VALID_INTERNAL_CLIENT_DEPTS.join(', ')}.`,
      });
    } else {
      row.internalClientDept = normDept;
    }

    // Required: intakeType — normalize
    const normIntake = normalizeIntakeType(row.intakeType);
    if (!normIntake) {
      rowErrors.push({
        rowNumber: row.rowNumber,
        field: 'Intake Type',
        message: `"${row.intakeType}" is not valid. Use: ${VALID_INTAKE_TYPES.join(', ')}.`,
      });
    } else {
      row.intakeType = normIntake;
    }

    // Conditional: adHocChannel required for GCG Ad-Hoc
    if (normIntake === 'GCG Ad-Hoc') {
      if (!row.adHocChannel) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          field: 'Ad-Hoc Channel',
          message: 'Required for GCG Ad-Hoc rows. Use: In-Person, Email, or Teams.',
        });
      } else {
        const normChannel = normalizeChannel(row.adHocChannel);
        if (!normChannel) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            field: 'Ad-Hoc Channel',
            message: `"${row.adHocChannel}" is not valid. Use: ${VALID_AD_HOC_CHANNELS.join(', ')}.`,
          });
        } else {
          row.adHocChannel = normChannel;
        }
      }
    }

    // Required: type (project type) — normalize
    const normType = normalizeProjectType(row.type);
    if (!normType) {
      rowErrors.push({
        rowNumber: row.rowNumber,
        field: 'Project Type',
        message: `"${row.type}" is not valid. Use: ${VALID_PROJECT_TYPES.join(', ')}.`,
      });
    } else {
      row.type = normType;
    }

    // Required: department — normalize (already resolved from internalClientDept if blank)
    const normResolvedDept = normalizeDept(row.department);
    if (!normResolvedDept) {
      rowErrors.push({
        rowNumber: row.rowNumber,
        field: 'Department',
        message: `"${row.department}" is not valid. Use: ${VALID_DEPARTMENTS.join(', ')}.`,
      });
    } else {
      row.department = normResolvedDept;
    }

    // Required: dateStarted (already validated as parseable in parser)
    if (!row.dateStarted) {
      rowErrors.push({ rowNumber: row.rowNumber, field: 'Date Started', message: 'Required field is missing or unparseable.' });
    }

    // Required: status — normalize
    const normStatus = normalizeStatus(row.status);
    if (!normStatus) {
      rowErrors.push({
        rowNumber: row.rowNumber,
        field: 'Status',
        message: `"${row.status}" is not valid. Use: ${VALID_STATUSES.join(', ')}.`,
      });
    } else {
      row.status = normStatus;
    }

    // Date logic: dateFinished must be >= dateStarted if provided
    if (row.dateFinished && row.dateStarted && row.dateFinished < row.dateStarted) {
      rowErrors.push({
        rowNumber: row.rowNumber,
        field: 'Date Finished',
        message: 'Date Finished must be on or after Date Started.',
      });
    }

    // Logic: Completed status should have a dateFinished
    if (normStatus === 'Completed' && !row.dateFinished) {
      rowWarnings.push({
        rowNumber: row.rowNumber,
        field: 'Date Finished',
        message: 'Completed rows should have a Date Finished. Today\'s date will be used.',
      });
      row.dateFinished = new Date().toISOString().slice(0, 10);
    }

    // Logic: non-Completed should not have dateFinished (warn only)
    if (normStatus !== 'Completed' && row.dateFinished) {
      rowWarnings.push({
        rowNumber: row.rowNumber,
        field: 'Date Finished',
        message: `Status is "${normStatus}" but Date Finished is set. It will be saved as-is.`,
      });
    }

    // Portfolio JSON validation
    if (row.portfolio) {
      try {
        const holdings = JSON.parse(row.portfolio);
        if (!Array.isArray(holdings)) {
          rowErrors.push({ rowNumber: row.rowNumber, field: 'Portfolio', message: 'Must be a JSON array of holdings.' });
        } else {
          for (let i = 0; i < holdings.length; i++) {
            const h = holdings[i];
            if (!h.identifier || typeof h.identifier !== 'string') {
              rowErrors.push({ rowNumber: row.rowNumber, field: 'Portfolio', message: `Holding ${i + 1}: missing or invalid identifier.` });
            }
            if (!VALID_CONSTITUENT_TYPES.includes(h.constituentType)) {
              rowErrors.push({ rowNumber: row.rowNumber, field: 'Portfolio', message: `Holding ${i + 1}: invalid constituentType "${h.constituentType}". Use: ${VALID_CONSTITUENT_TYPES.join(', ')}.` });
            }
            if (!VALID_ASSET_CLASSES.includes(h.assetClass)) {
              rowErrors.push({ rowNumber: row.rowNumber, field: 'Portfolio', message: `Holding ${i + 1}: invalid assetClass "${h.assetClass}". Use: ${VALID_ASSET_CLASSES.join(', ')}.` });
            }
            if (typeof h.weight !== 'number' || h.weight < 0 || h.weight > 1) {
              rowErrors.push({ rowNumber: row.rowNumber, field: 'Portfolio', message: `Holding ${i + 1}: weight must be a number between 0 and 1.` });
            }
          }
        }
      } catch {
        rowErrors.push({ rowNumber: row.rowNumber, field: 'Portfolio', message: 'Invalid JSON. Expected a JSON array of holdings.' });
      }
    }

    // Portfolio consistency warnings
    if (row.portfolioLogged && !row.portfolio) {
      rowWarnings.push({ rowNumber: row.rowNumber, field: 'Portfolio', message: 'Portfolio Logged is Yes but no portfolio data provided.' });
    }
    if (!row.portfolioLogged && row.portfolio) {
      rowWarnings.push({ rowNumber: row.rowNumber, field: 'Portfolio Logged', message: 'Portfolio data present but Portfolio Logged is No. It will be set to Yes.' });
      row.portfolioLogged = true;
    }

    // Structured notes JSON validation
    if (row.structuredNotes) {
      try {
        const notes = JSON.parse(row.structuredNotes);
        if (!Array.isArray(notes)) {
          rowErrors.push({ rowNumber: row.rowNumber, field: 'Notes (JSON)', message: 'Must be a JSON array of note entries.' });
        } else {
          for (let i = 0; i < notes.length; i++) {
            const n = notes[i];
            if (!n.text || typeof n.text !== 'string') {
              rowErrors.push({ rowNumber: row.rowNumber, field: 'Notes (JSON)', message: `Note ${i + 1}: missing or invalid "text" field.` });
            }
            if (!n.author || typeof n.author !== 'string') {
              rowErrors.push({ rowNumber: row.rowNumber, field: 'Notes (JSON)', message: `Note ${i + 1}: missing or invalid "author" field.` });
            }
          }
        }
      } catch {
        rowErrors.push({ rowNumber: row.rowNumber, field: 'Notes (JSON)', message: 'Invalid JSON. Expected a JSON array of note entries.' });
      }
    }

    errors.push(...rowErrors);
    warnings.push(...rowWarnings);

    if (rowErrors.length === 0) {
      validRows.push(row);
    }
  }

  return { errors, warnings, validRows };
}
