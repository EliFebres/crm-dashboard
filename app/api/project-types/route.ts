export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { hasDb } from '@/app/lib/db';
import { requireAuth, canModify, readOnlyError } from '@/app/lib/auth/require-auth';
import { listProjectTypes, createProjectType, ProjectTypeError } from '@/app/lib/db/projectTypes';
import { logActivity } from '@/app/lib/activity/log';
import { engagements as mockEngagements } from '@/app/lib/data/engagements';

// Colors the canonical project types used when hardcoded — reused for mock mode.
const MOCK_PROJECT_COLORS: Record<string, string> = {
  Meeting: '#8b5cf6',
  'Discovery Meeting': '#22d3ee',
  'Data Request': '#a5f3fc',
  'Data Update': '#f97316',
  PCR: '#f43f5e',
  'Follow-up Material': '#f59e0b',
  'Follow-up Meeting': '#10b981',
  Other: '#71717a',
};
const MOCK_PROJECT_ORDER = ['Meeting', 'Discovery Meeting', 'Data Request', 'Data Update', 'PCR', 'Follow-up Material', 'Follow-up Meeting', 'Other'];

// GET /api/project-types — authenticated. Lists managed project types + usage counts.
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  try {
    if (!hasDb()) {
      // Mock fallback: derive from in-memory engagement data (read-only).
      const counts = new Map<string, number>();
      mockEngagements.forEach(e => {
        counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
      });
      const projectTypes = Array.from(counts.keys())
        .sort((a, b) => (MOCK_PROJECT_ORDER.indexOf(a) + 1 || 99) - (MOCK_PROJECT_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b))
        .map((name, i) => ({
          id: name,
          name,
          color: MOCK_PROJECT_COLORS[name] ?? '#71717a',
          sortOrder: i,
          role: name === 'PCR' ? 'pcr' : null,
          assignedCount: counts.get(name) ?? 0,
        }));
      return NextResponse.json({ projectTypes });
    }

    return NextResponse.json({ projectTypes: await listProjectTypes() });
  } catch (err) {
    console.error('[GET /api/project-types]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

// POST /api/project-types — editors only. Body: { name, color? }
export async function POST(req: NextRequest) {
  if (!hasDb()) {
    return NextResponse.json({ error: 'Database not configured. Set SQLITE_DIR to enable write operations.' }, { status: 503 });
  }
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!canModify(auth.payload)) return readOnlyError();

  try {
    const body = await req.json();
    const created = await createProjectType(
      typeof body.name === 'string' ? body.name : '',
      body.color
    );
    void logActivity(req, {
      action: 'projectType.create',
      entityType: 'projectType',
      entityId: created.id,
      details: { name: created.name },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof ProjectTypeError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[POST /api/project-types]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
