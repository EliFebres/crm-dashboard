export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { hasDb } from '@/app/lib/db';
import { requireAuth, canModify, readOnlyError } from '@/app/lib/auth/require-auth';
import { listDepartments, createDepartment, DeptError } from '@/app/lib/db/departments';
import { logActivity } from '@/app/lib/activity/log';
import { engagements as mockEngagements } from '@/app/lib/data/engagements';

// Colors the four canonical departments used when hardcoded — reused for mock mode.
const MOCK_DEPT_COLORS: Record<string, string> = {
  Advisory: '#a5f3fc',
  Brokerage: '#22d3ee',
  Institutional: '#0e7490',
  Retirement: '#67e8f9',
};

// GET /api/departments — authenticated. Lists managed departments + usage counts.
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  try {
    if (!hasDb()) {
      // Mock fallback: derive from in-memory engagement data (read-only).
      const counts = new Map<string, number>();
      mockEngagements.forEach(e => {
        const d = e.internalClient.clientDept;
        counts.set(d, (counts.get(d) ?? 0) + 1);
      });
      const order = ['Advisory', 'Brokerage', 'Institutional', 'Retirement'];
      const departments = Array.from(counts.keys())
        .sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b))
        .map((name, i) => ({
          id: name,
          name,
          color: MOCK_DEPT_COLORS[name] ?? '#71717a',
          sortOrder: i,
          assignedCount: counts.get(name) ?? 0,
        }));
      return NextResponse.json({ departments });
    }

    return NextResponse.json({ departments: await listDepartments() });
  } catch (err) {
    console.error('[GET /api/departments]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

// POST /api/departments — editors only. Body: { name, color? }
export async function POST(req: NextRequest) {
  if (!hasDb()) {
    return NextResponse.json({ error: 'Database not configured. Set SQLITE_DIR to enable write operations.' }, { status: 503 });
  }
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!canModify(auth.payload)) return readOnlyError();

  try {
    const body = await req.json();
    const created = await createDepartment(
      typeof body.name === 'string' ? body.name : '',
      body.color
    );
    void logActivity(req, {
      action: 'department.create',
      entityType: 'department',
      entityId: created.id,
      details: { name: created.name },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof DeptError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[POST /api/departments]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
