export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { emitEngagementChange, type EngagementEventType } from '@/app/lib/events';

const VALID_TYPES: readonly EngagementEventType[] = ['created', 'updated', 'deleted'];

/**
 * Constant-time secret comparison. `timingSafeEqual` throws on length mismatch, so
 * compare lengths first — that leak (the secret's length) is not worth defending.
 */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// POST /api/internal/nudge
// Headers: x-sync-secret: <SYNC_NUDGE_SECRET>
// Body: { type: 'created' | 'updated' | 'deleted' }
//
// Re-broadcasts an engagement change over SSE on behalf of an out-of-process writer.
//
// `emitEngagementChange` drives an in-process Node EventEmitter (app/lib/events), which
// only the Next.js server can touch. The Python automation in backend/crm_sync writes
// straight to SQLite, so its rows appear on the next dashboard fetch but cannot wake up
// tabs that are already open. This endpoint closes that gap.
//
// It lives under /api/internal/ rather than /api/client-interactions/ on purpose:
// proxy.ts only force-gates those two prefixes behind a JWT session cookie, and a
// headless job has no cookie. Authentication here is a shared secret instead.
export async function POST(req: NextRequest) {
  const expected = process.env.SYNC_NUDGE_SECRET;
  // Fail closed: an unset secret must never mean "no auth required".
  if (!expected) {
    return NextResponse.json(
      { error: 'Nudge endpoint is not configured. Set SYNC_NUDGE_SECRET.' },
      { status: 503 }
    );
  }

  const provided = req.headers.get('x-sync-secret');
  if (!provided || !secretMatches(provided, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let type: unknown;
  try {
    ({ type } = await req.json());
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 });
  }

  if (typeof type !== 'string' || !VALID_TYPES.includes(type as EngagementEventType)) {
    return NextResponse.json(
      { error: `type must be one of: ${VALID_TYPES.join(', ')}` },
      { status: 400 }
    );
  }

  emitEngagementChange(type as EngagementEventType);
  return new Response(null, { status: 204 });
}
