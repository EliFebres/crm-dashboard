export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT, SESSION_COOKIE } from '@/app/lib/auth/jwt';
import { reorderTitles } from '@/app/lib/db/titles';
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

// PATCH /api/titles/reorder — admin only. Body: { ids: string[] }
// Persists a new rank order (sort_order = position in `ids`).
export async function PATCH(req: NextRequest) {
  try {
    const payload = await requireAdmin(req);
    if (!payload) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });

    const body = await req.json();
    const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: unknown) => typeof x === 'string') : [];
    if (ids.length === 0) {
      return NextResponse.json({ error: 'A non-empty "ids" array is required.' }, { status: 400 });
    }
    await reorderTitles(ids);
    void logActivity(req, {
      action: 'title.reorder',
      entityType: 'title',
      details: { count: ids.length },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[PATCH /api/titles/reorder]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
