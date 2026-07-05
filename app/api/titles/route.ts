export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT, SESSION_COOKIE } from '@/app/lib/auth/jwt';
import { listTitles, createTitle, TitleError } from '@/app/lib/db/titles';
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

// GET /api/titles — public. The signup form needs the list before auth.
export async function GET() {
  try {
    return NextResponse.json(await listTitles());
  } catch (err) {
    console.error('[GET /api/titles]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

// POST /api/titles — admin only. Body: { name }
export async function POST(req: NextRequest) {
  try {
    const payload = await requireAdmin(req);
    if (!payload) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });

    const body = await req.json();
    const created = await createTitle(typeof body.name === 'string' ? body.name : '');
    void logActivity(req, {
      action: 'title.create',
      entityType: 'title',
      entityId: created.id,
      details: { name: created.name },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof TitleError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[POST /api/titles]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
