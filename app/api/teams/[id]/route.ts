export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT, SESSION_COOKIE } from '@/app/lib/auth/jwt';
import { renameOrg, deleteOrg, OrgError } from '@/app/lib/db/org';
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

// PATCH /api/teams/:id — admin only. Body: { name }. Cascades the rename.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await requireAdmin(req);
    if (!payload) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });

    const { id } = await params;
    const body = await req.json();
    const updated = await renameOrg('team', id, typeof body.name === 'string' ? body.name : '');
    void logActivity(req, {
      action: 'team.update',
      entityType: 'team',
      entityId: id,
      details: { name: updated.name },
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof OrgError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[PATCH /api/teams/[id]]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

// DELETE /api/teams/:id — admin only. Refuses while anyone is still assigned.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await requireAdmin(req);
    if (!payload) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });

    const { id } = await params;
    const name = await deleteOrg('team', id);
    void logActivity(req, {
      action: 'team.delete',
      entityType: 'team',
      entityId: id,
      details: { name },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof OrgError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[DELETE /api/teams/[id]]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
