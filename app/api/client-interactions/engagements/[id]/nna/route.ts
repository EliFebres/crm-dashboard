export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { execute, query, hasDb } from '@/app/lib/db';
import { requireAuth, teamConstraint, canModify, readOnlyError, canEditEngagement, notTeamMemberError } from '@/app/lib/auth/require-auth';
import { teamScopeClause } from '@/app/lib/db/queries';
import { emitEngagementChange } from '@/app/lib/events';
import { logActivity } from '@/app/lib/activity/log';
import { normalizeNnaDetails, parseStoredAllocations } from '@/app/lib/nna';

// PATCH /api/client-interactions/engagements/:id/nna
// Body: { nna: number | null, allocations?: { ticker, amount }[] | null, notes?: string | null }
// nna: null clears the breakdown and notes too.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!hasDb()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!canModify(auth.payload)) return readOnlyError();
  const sc = teamConstraint(auth.payload);

  try {
    const { id } = await params;
    const engagementId = Number(id);
    const body = await req.json();

    const teamRows = await query<{ team_members: string; nna_allocations: string | null }>(
      `SELECT team_members, nna_allocations FROM engagements WHERE id = ?`,
      [engagementId]
    );
    if (teamRows.length === 0) {
      return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
    }
    const currentTeamMembers = JSON.parse(teamRows[0].team_members || '[]') as string[];
    if (!canEditEngagement(auth.payload, currentTeamMembers)) return notTeamMemberError();

    // `allocations` / `notes` are optional: omitted means "leave unchanged", so a
    // caller sending only { nna } behaves exactly as before.
    const result = normalizeNnaDetails(
      { nna: body.nna, allocations: body.allocations, notes: body.notes },
      parseStoredAllocations(teamRows[0].nna_allocations)
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    const { nna, allocations, notes } = result.value;

    const setClauses = ['nna = ?'];
    const values: unknown[] = [nna];
    if (allocations !== undefined) {
      setClauses.push('nna_allocations = ?');
      values.push(allocations ? JSON.stringify(allocations) : null);
    }
    if (notes !== undefined) {
      setClauses.push('nna_notes = ?');
      values.push(notes);
    }

    const { clause: teamClause, params: teamParams } = teamScopeClause(sc);

    await execute(
      `UPDATE engagements SET ${setClauses.join(', ')} WHERE id = ? ${teamClause}`,
      [...values, engagementId, ...teamParams]
    );
    const saved = await query<{ nna: number | null; nna_allocations: string | null; nna_notes: string | null }>(
      `SELECT nna, nna_allocations, nna_notes FROM engagements WHERE id = ?`,
      [engagementId]
    );
    const savedAllocations = parseStoredAllocations(saved[0]?.nna_allocations);

    emitEngagementChange('updated');
    const clientRows = await query<{ internal_client_name: string | null }>(
      `SELECT internal_client_name FROM engagements WHERE id = ?`,
      [engagementId]
    );
    void logActivity(req, {
      action: 'engagement.nna_change',
      entityType: 'engagement',
      entityId: engagementId,
      details: {
        nna,
        tickers: savedAllocations?.map(a => a.ticker) ?? [],
        internalClient: clientRows[0]?.internal_client_name ?? null,
      },
    });
    return NextResponse.json({
      id: engagementId,
      nna: saved[0]?.nna ?? undefined,
      nnaAllocations: savedAllocations,
      nnaNotes: saved[0]?.nna_notes ?? null,
    });
  } catch (err) {
    console.error('PATCH .../nna error:', err);
    return NextResponse.json({ error: 'Failed to update NNA' }, { status: 500 });
  }
}
