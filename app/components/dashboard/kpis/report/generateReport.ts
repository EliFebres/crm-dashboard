import React from 'react';
import { getKpiReport, type KpiReportSubject, type KpiScope } from '@/app/lib/api/kpi';

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'report';
}

/**
 * Fetches the report data, renders the PDF in the browser and downloads it.
 *
 * react-pdf and the document are imported on demand so the renderer (a few hundred KB)
 * only loads when someone actually clicks Generate PDF.
 */
export async function generateReport(req: { scope: KpiScope; period: string; subject: KpiReportSubject }): Promise<void> {
  const [data, { pdf }, { default: ReportDocument }] = await Promise.all([
    getKpiReport(req),
    import('@react-pdf/renderer'),
    import('./ReportDocument'),
  ]);

  const blob = await pdf(React.createElement(ReportDocument, { data }) as Parameters<typeof pdf>[0]).toBlob();

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slug(data.subject.name)}-${data.period.toLowerCase()}-review-${data.generatedAt.slice(0, 10)}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
