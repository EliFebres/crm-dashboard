export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { hasDb } from '@/app/lib/db';
import { requireAuth, canModify, readOnlyError } from '@/app/lib/auth/require-auth';
import { listIntakeTypes, createIntakeType, IntakeTypeError } from '@/app/lib/db/intakeTypes';
import { logActivity } from '@/app/lib/activity/log';
import { engagements as mockEngagements } from '@/app/lib/data/engagements';

// Colors the canonical intake types used when hardcoded — reused for mock mode.
const MOCK_INTAKE_COLORS: Record<string, string> = {
  IRQ: '#3b82f6',
  SERF: '#10b981',
  'Ad-Hoc': '#ec4899',
};
const MOCK_INTAKE_ORDER = ['IRQ', 'SERF', 'Ad-Hoc'];

// GET /api/intake-types — authenticated. Lists managed intake types + usage counts.
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  try {
    if (!hasDb()) {
      // Mock fallback: derive from in-memory engagement data (read-only).
      const counts = new Map<string, number>();
      mockEngagements.forEach(e => {
        const t = e.intakeType;
        counts.set(t, (counts.get(t) ?? 0) + 1);
      });
      const intakeTypes = Array.from(counts.keys())
        .sort((a, b) => (MOCK_INTAKE_ORDER.indexOf(a) + 1 || 99) - (MOCK_INTAKE_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b))
        .map((name, i) => ({
          id: name,
          name,
          color: MOCK_INTAKE_COLORS[name] ?? '#71717a',
          sortOrder: i,
          role: MOCK_INTAKE_ORDER.includes(name) ? name.toLowerCase().replace('-', '_') : null,
          assignedCount: counts.get(name) ?? 0,
        }));
      return NextResponse.json({ intakeTypes });
    }

    return NextResponse.json({ intakeTypes: await listIntakeTypes() });
  } catch (err) {
    console.error('[GET /api/intake-types]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

// POST /api/intake-types — editors only. Body: { name, color? }
export async function POST(req: NextRequest) {
  if (!hasDb()) {
    return NextResponse.json({ error: 'Database not configured. Set SQLITE_DIR to enable write operations.' }, { status: 503 });
  }
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!canModify(auth.payload)) return readOnlyError();

  try {
    const body = await req.json();
    const created = await createIntakeType(
      typeof body.name === 'string' ? body.name : '',
      body.color
    );
    void logActivity(req, {
      action: 'intakeType.create',
      entityType: 'intakeType',
      entityId: created.id,
      details: { name: created.name },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof IntakeTypeError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[POST /api/intake-types]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
