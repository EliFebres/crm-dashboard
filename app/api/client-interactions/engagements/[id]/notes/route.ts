export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { query, execute, hasDb } from '@/app/lib/db';
import { verifyJWT, SESSION_COOKIE } from '@/app/lib/auth/jwt';
import { canModify, readOnlyError, canEditEngagement, notTeamMemberError } from '@/app/lib/auth/require-auth';
import type { NoteEntry } from '@/app/lib/types/engagements';
import { emitEngagementChange } from '@/app/lib/events';
import { logActivity } from '@/app/lib/activity/log';

type RouteParams = { params: Promise<{ id: string }> };

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

// GET /api/client-interactions/engagements/:id/notes
// Returns all note entries for an engagement, oldest first.
export async function GET(req: NextRequest, { params }: RouteParams) {
  if (!hasDb()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }
  try {
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    if (!token) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    try { await verifyJWT(token); } catch {
      return NextResponse.json({ error: 'Invalid or expired session.' }, { status: 401 });
    }

    const { id } = await params;
    const engagementId = Number(id);

    const rows = await query<Record<string, unknown>>(
      `SELECT * FROM engagement_notes WHERE engagement_id = ? ORDER BY created_at ASC`,
      [engagementId]
    );

    return NextResponse.json({ notes: rows.map(rowToNoteEntry) });
  } catch (err) {
    console.error('GET .../notes error:', err);
    return NextResponse.json({ error: 'Failed to fetch notes' }, { status: 500 });
  }
}

// POST /api/client-interactions/engagements/:id/notes
// Appends a new note entry attributed to the authenticated user.
// Body: { noteText: string }
export async function POST(req: NextRequest, { params }: RouteParams) {
  if (!hasDb()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }
  try {
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    if (!token) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

    let payload;
    try { payload = await verifyJWT(token); } catch {
      return NextResponse.json({ error: 'Invalid or expired session.' }, { status: 401 });
    }
    if (!canModify(payload)) return readOnlyError();

    const { id } = await params;
    const engagementId = Number(id);
    const { noteText } = await req.json();

    if (!noteText || !noteText.trim()) {
      return NextResponse.json({ error: 'noteText is required.' }, { status: 400 });
    }

    const teamRows = await query<{ team_members: string }>(
      `SELECT team_members FROM engagements WHERE id = ?`,
      [engagementId]
    );
    if (teamRows.length === 0) {
      return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
    }
    const currentTeamMembers = JSON.parse(teamRows[0].team_members || '[]') as string[];
    if (!canEditEngagement(payload, currentTeamMembers)) return notTeamMemberError();

    const authorName = `${payload.firstName} ${payload.lastName}`;
    const authorId = payload.sub;

    await execute(
      `INSERT INTO engagement_notes (engagement_id, note_text, author_name, author_id)
       VALUES (?, ?, ?, ?)`,
      [engagementId, noteText.trim(), authorName, authorId]
    );

    // Return the newly created entry
    const rows = await query<Record<string, unknown>>(
      `SELECT * FROM engagement_notes
       WHERE engagement_id = ? AND author_id = ?
       ORDER BY created_at DESC LIMIT 1`,
      [engagementId, authorId]
    );

    emitEngagementChange('updated');
    const newNote = rowToNoteEntry(rows[0]);
    const clientRows = await query<{ internal_client_name: string | null }>(
      `SELECT internal_client_name FROM engagements WHERE id = ?`,
      [engagementId]
    );
    void logActivity(req, {
      action: 'note.create',
      entityType: 'note',
      entityId: newNote.id,
      details: {
        engagementId,
        length: newNote.noteText.length,
        internalClient: clientRows[0]?.internal_client_name ?? null,
      },
    });
    return NextResponse.json(newNote, { status: 201 });
  } catch (err) {
    console.error('POST .../notes error:', err);
    return NextResponse.json({ error: 'Failed to add note' }, { status: 500 });
  }
}
