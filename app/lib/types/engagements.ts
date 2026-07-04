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
  serfCount: number;
  serfPercent: number;
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

export type AssetClass = 'Equity' | 'Fixed Income' | 'Alternatives' | 'Crypto' | 'Fund of Funds';
export type ConstituentType = 'Portfolio' | 'Morningstar-Fund' | 'Security' | 'Index';

export interface PortfolioHolding {
  identifier: string; // Ticker, ISIN, or CUSIP
  constituentType: ConstituentType;
  assetClass: AssetClass;
  weight: number; // Normalized weight (0-1, sums to 1)
}

export interface NoteEntry {
  id: number;
  engagementId: number;
  noteText: string;
  authorName: string;
  authorId: string;
  createdAt: string; // ISO string
}

export interface Engagement {
  id: number;
  clientCrn: string; // CRN of the registered external client (required)
  crnPending?: boolean; // true when clientCrn is a placeholder awaiting the real value
  externalClient: string; // Canonical external-client name, resolved from the registry via JOIN
  internalClient: InternalClient; // Contact/relationship owner/salesperson
  intakeType: 'IRQ' | 'SERF' | 'Ad-Hoc';
  adHocChannel?: AdHocChannel; // Only applicable when intakeType is 'Ad-Hoc'
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
