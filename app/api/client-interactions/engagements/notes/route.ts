export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { query, hasDb } from '@/app/lib/db';
import { verifyJWT, SESSION_COOKIE } from '@/app/lib/auth/jwt';
import type { NoteEntry } from '@/app/lib/types/engagements';

function rowToNoteEntry(row: Record<string, unknown>): NoteEntry {
  return {
    id: Number(row.id),
    engagementId: Number(row.engagement_id),
    noteText: row.note_text as string,
    authorName: row.author_name as string,
    authorId: row.author_id as string,
    createdAt: String(row.created_at),
  };
}

// GET /api/client-interactions/engagements/notes?ids=1,2,3
// Batch form of GET .../engagements/:id/notes (same auth): returns
// { notes: { [engagementId]: NoteEntry[] } }, each list oldest first.
export async function GET(req: NextRequest) {
  if (!hasDb()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }
  try {
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    if (!token) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    try { await verifyJWT(token); } catch {
      return NextResponse.json({ error: 'Invalid or expired session.' }, { status: 401 });
    }

    const ids = [...new Set(
      (req.nextUrl.searchParams.get('ids') ?? '')
        .split(',')
        .map(Number)
        .filter(n => Number.isInteger(n) && n > 0)
    )].slice(0, 1000);

    const notes: Record<string, NoteEntry[]> = {};
    for (const id of ids) notes[id] = [];
    if (ids.length > 0) {
      const rows = await query<Record<string, unknown>>(
        `SELECT * FROM engagement_notes
         WHERE engagement_id IN (${ids.map(() => '?').join(',')})
         ORDER BY created_at ASC, id ASC`,
        ids
      );
      for (const row of rows) notes[Number(row.engagement_id)].push(rowToNoteEntry(row));
    }
    return NextResponse.json({ notes });
  } catch (err) {
    console.error('GET .../engagements/notes error:', err);
    return NextResponse.json({ error: 'Failed to fetch notes' }, { status: 500 });
  }
}
