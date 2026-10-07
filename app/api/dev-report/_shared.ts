import { NextResponse } from 'next/server';
import { DevReportError } from '@/app/lib/db/dev-report';

export const NO_DB = { error: 'Database not configured. Set SQLITE_DIR to enable write operations.' };

/** Translates a thrown error into a JSON response (DevReportError keeps its status). */
export function errorResponse(err: unknown, where: string): NextResponse {
  if (err instanceof DevReportError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error(`[${where}]`, err);
  return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
}
