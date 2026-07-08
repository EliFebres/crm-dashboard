/**
 * One-line "how is this determined" blurbs shown in the info tooltip next to each
 * question number. Kept deliberately compressed — only the top-level calculation.
 */
export const Q_EXPLAIN: Record<string, string> = {
  Q1: 'Headline totals for the chosen scope & period (interactions, NNA, completion rate, zero-NNA rate…), each vs. the prior period.',
  Q2: 'Weekly counts over the last 26 weeks: engagements opened (by start date) vs. completed (by finish date).',
  Q3: 'Each month’s share of engagements that are high-touch (Discovery Meeting, Meeting, Follow-up Meeting) vs. data tasks (every other type), over 12 months.',
  Q4: 'Per project type, the median and 90th-percentile (P90) turnaround in days across all completed work (types with ≥5 completions).',
  Q5: 'Open work (In Progress / Awaiting Meeting) that started 3+ weeks ago, oldest first.',
  Q6: 'Per client department, total interactions / total NNA / NNA-per-interaction for the chosen scope & period.',
  Q7: 'Top clients ranked by NNA, drawn as a cumulative-share (Pareto) curve.',
  Q8: 'Per originating project type, direct NNA plus the NNA rolled up from the follow-up chain it spawned.',
  Q9: 'For each project-type × department cell: the % of completed work that landed NNA, over the median NNA amount.',
  Q10: 'Projects flagged “Follow Up” (delivered, NNA pending) that started 6+ months ago, oldest first.',
  Q11: 'Flow of engagement volume from intake channel → project type → outcome; the table lists the most common end-to-end journeys.',
  Q12: 'Per project type, the % of engagements that spawned at least one follow-up (a child in the chain); types with ≥8 occurrences.',
  Q13: 'Per month, new (first-ever) vs. returning clients; plus unique clients per department over the last year.',
  Q14: 'Clients with 3+ past engagements whose last activity was 60+ days ago, longest-silent first.',
};
