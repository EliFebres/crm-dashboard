// Types for Client Engagements Dashboard

export type AdHocChannel = 'In-Person' | 'Email' | 'Teams';

export interface DayData {
  date: Date;
  level: number;
  count: number;
  projectCount: number;
  adHocCount: number;
}

export interface IntakeBreakdown {
  intake: string;
  count: number;
  percent: number;
  color: string;
}

export interface IntakeSourceBreakdown {
  irqCount: number;
  irqPercent: number;
  irqColor: string;  // Managed chart color of the IRQ intake type (from the registry)
  serfCount: number;
  serfPercent: number;
  serfColor: string; // Managed chart color of the SERF intake type (from the registry)
  portfoliosLogged: number;
  portfoliosTotal: number;
  portfoliosPercent: number;
}

export interface NNATier {
  label: string;
  count: number;
  color: string;
}

export interface EngagementMetric {
  label: string;
  sublabel: string;
  value: string;
  change: string;
  isPositive: boolean;
  icon: string; // Icon name as string - component will map to actual icon
  percent?: number; // Optional percentage for progress bar visualization
  sparklineData?: { value: number }[]; // Optional sparkline data for trend visualization
  pieData?: { name: string; value: number; color: string }[]; // Optional pie chart data for breakdown visualization
  intakeBreakdown?: IntakeBreakdown[]; // Optional intake breakdown for Ad-Hoc
  intakeSourceBreakdown?: IntakeSourceBreakdown; // Optional intake source breakdown for Client Projects
  nnaTiers?: NNATier[]; // Optional NNA distribution tiers
}

export interface DepartmentData {
  name: string;
  value: number; // Percentage for bar width (sums to 100)
  count: number; // Raw count for display
  color: string;
}

export interface InternalClient {
  name: string;
  clientDept: string; // A managed department name (see the departments table)
}

// A registered external client. The CRN is the canonical, unique identifier; the
// name is the single canonical display name (lives only in the clients registry).
export interface Client {
  crn: string;
  name: string;
  createdByName?: string;
  createdAt?: string;
  crnPending?: boolean; // true when `crn` is a placeholder awaiting the real value
}

export type AssetClass = 'Equity' | 'Fixed Income' | 'Alternatives' | 'Crypto' | 'Fund of Funds' | 'Multi-Asset';
export type ConstituentType = 'Portfolio' | 'Morningstar-Fund' | 'Security' | 'Index';

export interface PortfolioHolding {
  identifier: string; // Ticker, ISIN, or CUSIP
  constituentType: ConstituentType;
  assetClass: AssetClass;
  weight: number; // Normalized weight (0-1, sums to 1)
}

// A model portfolio belonging to an external client (keyed by CRN). A client can
// run several (e.g. large- vs small-client models, per-office models, 60/40 vs
// 100/0 splits); exactly one is flagged `isMain` (drives the Portfolio Trends
// dashboard). Canonical + shared across all of that client's interactions.
export interface ClientModel {
  id: string;                   // stable UUID
  name: string;                 // free-text label, e.g. "60/40 Model"
  isMain: boolean;              // exactly one main per client
  aum?: number;                 // optional dollars (often unknown/empty)
  holdings: PortfolioHolding[]; // weights normalized to sum to 1
  sortOrder: number;
  createdAt?: string;           // when first logged (preserved across saves)
  updatedAt?: string;           // when last logged/changed (bumps only on content change)
}

// Source-agnostic note shape shared by the reusable NotesModal. Anything that
// can supply/persist a list of authored notes (engagements, tickers, …) uses this.
export interface BaseNote {
  id: number;
  noteText: string;    // stored as HTML (Tiptap) or legacy plain text
  authorName: string;
  authorId: string;
  createdAt: string;   // ISO string
}

export interface NoteEntry extends BaseNote {
  engagementId: number;
}

export interface Engagement {
  id: number;
  clientCrn: string; // CRN of the registered external client (required)
  crnPending?: boolean; // true when clientCrn is a placeholder awaiting the real value
  externalClient: string; // Canonical external-client name, resolved from the registry via JOIN
  internalClient: InternalClient; // Contact/relationship owner/salesperson
  intakeType: string; // A managed intake-type name (IRQ/SERF/Ad-Hoc are built-in; admins can add more)
  adHocChannel?: AdHocChannel; // Only applicable when the intake type has the 'ad_hoc' role
  type: string; // Project Type
  teamMembers: string[];
  department: string;
  dateStarted: string;
  dateFinished: string;
  status: string;
  portfolioLogged: boolean;
  portfolio?: PortfolioHolding[]; // Optional client portfolio holdings
  nna?: number; // Net New Assets - dollar amount of AUM moved into funds (optional)
  notes?: string; // Optional notes field (legacy — used by engagement form)
  noteCount?: number; // Number of entries in engagement_notes table (undefined when not loaded)
  version?: number; // Optimistic locking counter — send back with PATCH to detect concurrent edits
  tickersMentioned?: string[]; // Tickers discussed during Ad-Hoc interactions (used for Ticker Trends)
  createdById?: string; // User ID of the person who created this engagement
  createdByName?: string; // Display name of the creator
  linkedFromId?: number | null; // Parent engagement this one was the result of (for funnel KPIs)
  filepath?: string | null; // Path to the project's source folder on disk (for opening in File Explorer)
}

// Slim shape for the link picker — avoids fetching full engagement payloads
export interface EngagementLinkSummary {
  id: number;
  dateStarted: string;
  type: string;
  intakeType: string;
  internalClientName: string;
  internalClientDept: string;
  clientCrn: string;
  externalClient: string; // Canonical external-client name, resolved from the registry
}

export interface ContributionData {
  weeks: DayData[][];
}
