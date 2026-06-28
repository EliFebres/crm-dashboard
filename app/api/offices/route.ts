export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT, SESSION_COOKIE } from '@/app/lib/auth/jwt';
import { listOrg, createOrg, OrgError } from '@/app/lib/db/org';
import { logActivity } from '@/app/lib/activity/log';

async function requireAdmin(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const payload = await verifyJWT(token);
    if (payload.role !== 'admin') return null;
    return payload;
  } catch {
    return null;
  }
}

// GET /api/offices — public. The signup form needs the list before auth.
export async function GET() {
  try {
    return NextResponse.json(await listOrg('office'));
  } catch (err) {
    console.error('[GET /api/offices]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

// POST /api/offices — admin only. Body: { name }
export async function POST(req: NextRequest) {
  try {
    const payload = await requireAdmin(req);
    if (!payload) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });

    const body = await req.json();
    const created = await createOrg('office', typeof body.name === 'string' ? body.name : '');
    void logActivity(req, {
      action: 'office.create',
      entityType: 'office',
      entityId: created.id,
      details: { name: created.name },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof OrgError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[POST /api/offices]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
