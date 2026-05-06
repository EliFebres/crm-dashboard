export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { query, queryWrite } from '@/app/lib/db';
import { verifyJWT, SESSION_COOKIE } from '@/app/lib/auth/jwt';
import { canModify, readOnlyError, canEditEngagement, notTeamMemberError } from '@/app/lib/auth/require-auth';
import type { NoteEntry } from '@/app/lib/types/engagements';
import { logActivity } from '@/app/lib/activity/log';

type RouteParams = { params: Promise<{ id: string; noteId: string }> };

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

// PATCH /api/client-interactions/engagements/:id/notes/:noteId
// Updates note text. Only the note's author may edit it.
// Body: { noteText: string }
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  if (!process.env.DUCKDB_DIR) {
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

    const { id: engagementIdParam, noteId } = await params;
    const id = Number(noteId);
    const engagementId = Number(engagementIdParam);
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

    // Atomic ownership check + update: if author_id doesn't match, 0 rows returned
    const updated = await queryWrite<Record<string, unknown>>(
      `UPDATE engagement_notes SET note_text = ? WHERE id = ? AND author_id = ? RETURNING *`,
      [noteText.trim(), id, payload.sub]
    );

    if (updated.length === 0) {
      const exists = await query(`SELECT id FROM engagement_notes WHERE id = ?`, [id]);
      if (exists.length === 0) {
        return NextResponse.json({ error: 'Note not found.' }, { status: 404 });
      }
      return NextResponse.json({ error: 'You can only edit your own notes.' }, { status: 403 });
    }

    const updatedNote = rowToNoteEntry(updated[0]);
    const clientRows = await query<{ internal_client_name: string | null }>(
      `SELECT internal_client_name FROM engagements WHERE id = ?`,
      [updatedNote.engagementId]
    );
    void logActivity(req, {
      action: 'note.update',
      entityType: 'note',
      entityId: updatedNote.id,
      details: {
        engagementId: updatedNote.engagementId,
        internalClient: clientRows[0]?.internal_client_name ?? null,
      },
    });
    return NextResponse.json(updatedNote);
  } catch (err) {
    console.error('PATCH .../notes/:noteId error:', err);
    return NextResponse.json({ error: 'Failed to update note' }, { status: 500 });
  }
}

// DELETE /api/client-interactions/engagements/:id/notes/:noteId
// Deletes a note. Only the note's author may delete it.
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  if (!process.env.DUCKDB_DIR) {
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

    const { id: engagementIdParam, noteId } = await params;
    const id = Number(noteId);
    const engagementId = Number(engagementIdParam);

    const teamRows = await query<{ team_members: string }>(
      `SELECT team_members FROM engagements WHERE id = ?`,
      [engagementId]
    );
    if (teamRows.length === 0) {
      return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
    }
    const currentTeamMembers = JSON.parse(teamRows[0].team_members || '[]') as string[];
    if (!canEditEngagement(payload, currentTeamMembers)) return notTeamMemberError();

    // Atomic ownership check + delete: if author_id doesn't match, 0 rows returned
    const deleted = await queryWrite(
      `DELETE FROM engagement_notes WHERE id = ? AND author_id = ? RETURNING id`,
      [id, payload.sub]
    );

    if (deleted.length === 0) {
      const exists = await query(`SELECT id FROM engagement_notes WHERE id = ?`, [id]);
      if (exists.length === 0) {
        return NextResponse.json({ error: 'Note not found.' }, { status: 404 });
      }
      return NextResponse.json({ error: 'You can only delete your own notes.' }, { status: 403 });
    }

    const clientRows = await query<{ internal_client_name: string | null }>(
      `SELECT internal_client_name FROM engagements WHERE id = ?`,
      [engagementId]
    );
    void logActivity(req, {
      action: 'note.delete',
      entityType: 'note',
      entityId: id,
      details: {
        engagementId,
        internalClient: clientRows[0]?.internal_client_name ?? null,
      },
    });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('DELETE .../notes/:noteId error:', err);
    return NextResponse.json({ error: 'Failed to delete note' }, { status: 500 });
  }
}
