import React from 'react';
import { getKpiReport } from '@/app/lib/api/kpi';
import { getDevReport } from '@/app/lib/api/dev-report';

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'report';
}

/**
 * The founder's year-to-date review: their own KPI report ("My report", YTD) as page
 * one and the development page as page two — or just the development page.
 *
 * The KPI report is fetched either way: it supplies the name, title and team for the
 * development page's header. react-pdf loads on demand, as in generateReport.ts.
 */
export async function generateDevReport(opts: {
  displayName: string;
  includeKpi: boolean;
  /** TEMPORARY: fill the development page with dummy data (see devReportDemo.ts). */
  demo?: boolean;
}): Promise<void> {
  const [kpi, dev, { pdf, Document }, { KpiReportPage }, { default: DevReportPage }] = await Promise.all([
    getKpiReport({ scope: 'all', period: 'YTD', subject: { kind: 'person', displayName: opts.displayName } }),
    opts.demo ? import('./devReportDemo').then(m => m.buildDemoDevReport()) : getDevReport(),
    import('@react-pdf/renderer'),
    import('./ReportDocument'),
    import('./DevReportPage'),
  ]);

  const title = opts.includeKpi ? 'Year to date review' : 'Software development · Year to date';
  const doc = React.createElement(
    Document,
    { title: `${kpi.subject.name} · ${title}`, author: 'CRM Dashboard', creator: 'CRM Dashboard' },
    opts.includeKpi ? React.createElement(KpiReportPage, { data: kpi }) : null,
    React.createElement(DevReportPage, { data: dev, subject: kpi.subject, demo: opts.demo })
  );
  const blob = await pdf(doc as Parameters<typeof pdf>[0]).toBlob();

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const kind = `${opts.includeKpi ? 'ytd-performance-review' : 'ytd-development-report'}${opts.demo ? '-demo' : ''}`;
  a.download = `${slug(kpi.subject.name)}-${kind}-${dev.generatedAt.slice(0, 10)}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
