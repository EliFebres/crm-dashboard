'use client';

import React, { useState, useEffect, useRef, ReactNode } from 'react';
import { X, Plus, Loader2, Pencil, Trash2, Check, XCircle, Folder, Pin } from 'lucide-react';
import {
  getEngagementNotes,
  addEngagementNote,
  updateEngagementNote,
  deleteEngagementNote,
  updateEngagementFilepath,
} from '@/app/lib/api/client-interactions';
import { useCurrentUser } from '@/app/lib/auth/context';
import type { BaseNote } from '@/app/lib/types/engagements';
import RichTextEditor from '@/app/components/dashboard/shared/RichTextEditor';
import RichTextDisplay from '@/app/components/dashboard/shared/RichTextDisplay';

// Pluggable notes backend. Callers that don't pass one fall back to the
// engagement REST endpoints (keyed by `engagementId`); Ticker Trends injects a
// client-side store instead. Keeps this one modal reusable across resources.
export interface NoteSource {
  fetch: () => Promise<BaseNote[]>;
  add: (text: string) => Promise<BaseNote>;
  update: (noteId: number, text: string) => Promise<BaseNote>;
  remove: (noteId: number) => Promise<void>;
}

interface NotesModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle: ReactNode;
  engagementId?: number;
  // Inject a notes backend; when omitted, the engagement endpoints are used.
  notesSource?: NoteSource;
  // Re-fetch trigger for injected sources (e.g. the selected ticker symbol).
  resourceKey?: string | number;
  // Optional "show this note on the panel" control. When provided, each note gets
  // a pin button; `pinnedNoteId` marks the current one (defaults to newest).
  pinnedNoteId?: number | null;
  onPinNote?: (noteId: number) => void;
  readOnly?: boolean;
  filepath?: string | null;
  canEditFilepath?: boolean;
  onFilepathSaved?: (next: string | null) => void;
  onNoteAdded?: () => void;
  onNoteDeleted?: () => void;
}

function formatNoteDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const NotesModal: React.FC<NotesModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  engagementId,
  notesSource,
  resourceKey,
  pinnedNoteId = null,
  onPinNote,
  readOnly = false,
  filepath = null,
  canEditFilepath = false,
  onFilepathSaved,
  onNoteAdded,
  onNoteDeleted,
}) => {
  const { user } = useCurrentUser();
  const notesListRef = useRef<HTMLDivElement>(null);
  const [notes, setNotes] = useState<BaseNote[]>([]);

  // Resolve the active notes backend: the injected source, or the engagement
  // REST endpoints keyed by engagementId. Stored in a ref so it can change
  // freely without churning the fetch effect's dependencies.
  const source: NoteSource | null = notesSource ?? (engagementId != null ? {
    fetch: () => getEngagementNotes(engagementId),
    add: (text: string) => addEngagementNote(engagementId, text),
    update: (noteId: number, text: string) => updateEngagementNote(engagementId, noteId, text),
    remove: (noteId: number) => deleteEngagementNote(engagementId, noteId),
  } : null);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const [loading, setLoading] = useState(false);
  const [newText, setNewText] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingNoteId, setDeletingNoteId] = useState<number | null>(null);

  // Filepath state
  const [editingFilepath, setEditingFilepath] = useState(false);
  const [filepathDraft, setFilepathDraft] = useState('');
  const [savingFilepath, setSavingFilepath] = useState(false);
  const [filepathError, setFilepathError] = useState<string | null>(null);
  const [filepathFlash, setFilepathFlash] = useState<string | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch notes when modal opens
  useEffect(() => {
    if (!isOpen) return;
    const src = sourceRef.current;
    if (!src) return;
    setLoading(true);
    setNewText('');
    setEditingNoteId(null);
    setEditingFilepath(false);
    setFilepathError(null);
    setFilepathFlash(null);
    src.fetch()
      .then(setNotes)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [isOpen, engagementId, resourceKey]);

  // Clear the "Copied" / error flash after a short delay
  const showFlash = (msg: string) => {
    setFilepathFlash(msg);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFilepathFlash(null), 1500);
  };
  useEffect(() => () => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
  }, []);

  // Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleAddNote = async () => {
    const src = sourceRef.current;
    if (!newText.trim() || saving || !src) return;
    setSaving(true);
    try {
      const entry = await src.add(newText.trim());
      setNotes(prev => [...prev, entry]);
      setNewText('');
      onNoteAdded?.();
      setTimeout(() => {
        notesListRef.current?.scrollTo({ top: notesListRef.current.scrollHeight, behavior: 'smooth' });
      }, 0);
    } catch (err) {
      console.error('Failed to add note:', err);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (entry: BaseNote) => {
    setEditingNoteId(entry.id);
    setEditText(entry.noteText);
  };

  const cancelEdit = () => {
    setEditingNoteId(null);
    setEditText('');
  };

  const handleSaveEdit = async (noteId: number) => {
    const src = sourceRef.current;
    if (!editText.trim() || savingEdit || !src) return;
    setSavingEdit(true);
    try {
      const updated = await src.update(noteId, editText.trim());
      setNotes(prev => prev.map(n => n.id === noteId ? updated : n));
      setEditingNoteId(null);
      setEditText('');
    } catch (err) {
      console.error('Failed to update note:', err);
    } finally {
      setSavingEdit(false);
    }
  };

  const startEditFilepath = () => {
    setFilepathDraft(filepath ?? '');
    setFilepathError(null);
    setEditingFilepath(true);
  };

  const cancelEditFilepath = () => {
    setEditingFilepath(false);
    setFilepathDraft('');
    setFilepathError(null);
  };

  const handleSaveFilepath = async () => {
    if (savingFilepath || engagementId == null) return;
    const trimmed = filepathDraft.trim();
    const next = trimmed.length === 0 ? null : trimmed;
    setSavingFilepath(true);
    setFilepathError(null);
    try {
      await updateEngagementFilepath(engagementId, next);
      onFilepathSaved?.(next);
      setEditingFilepath(false);
      setFilepathDraft('');
    } catch (err) {
      setFilepathError(err instanceof Error ? err.message : 'Failed to save filepath');
    } finally {
      setSavingFilepath(false);
    }
  };

  const copyFilepathToClipboard = async () => {
    if (!filepath) return;
    try {
      await navigator.clipboard.writeText(filepath);
      showFlash('Copied');
    } catch {
      showFlash('Copy failed');
    }
  };

  const handleDeleteNote = async (noteId: number) => {
    const src = sourceRef.current;
    if (!src) return;
    setDeletingNoteId(noteId);
    try {
      await src.remove(noteId);
      setNotes(prev => prev.filter(n => n.id !== noteId));
      onNoteDeleted?.();
    } catch (err) {
      console.error('Failed to delete note:', err);
    } finally {
      setDeletingNoteId(null);
    }
  };

  if (!isOpen) return null;

  // Which note is "on the panel": the explicit pin, or the newest note by default.
  const newestNoteId = notes.length ? notes.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b)).id : null;
  const effectivePinnedId = onPinNote && pinnedNoteId != null && notes.some(n => n.id === pinnedNoteId)
    ? pinnedNoteId
    : newestNoteId;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-2xl bg-zinc-900 border border-zinc-700/50 shadow-2xl flex flex-col max-h-[85vh]">
        {/* Gradient border effect */}
        <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] via-transparent to-transparent pointer-events-none" />
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent" />

        {/* Header */}
        <div className="relative z-10 px-5 py-4 border-b border-zinc-800/50 flex items-start justify-between flex-shrink-0 gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-medium text-white">{title}</h2>
            <p className="text-xs text-muted mt-0.5">{subtitle}</p>

            {/* Filepath row */}
            {editingFilepath ? (
              <div className="mt-2 flex items-center gap-1.5">
                <Folder className="w-3.5 h-3.5 text-muted flex-shrink-0" />
                <input
                  type="text"
                  value={filepathDraft}
                  onChange={(e) => setFilepathDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSaveFilepath();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      e.stopPropagation();
                      cancelEditFilepath();
                    }
                  }}
                  placeholder="C:\path\to\project\folder"
                  autoFocus
                  disabled={savingFilepath}
                  className="flex-1 min-w-0 bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500/60 disabled:opacity-50"
                />
                <button
                  onClick={handleSaveFilepath}
                  disabled={savingFilepath}
                  className="p-1 text-cyan-400 hover:text-cyan-300 disabled:opacity-50"
                  title="Save"
                >
                  {savingFilepath ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={cancelEditFilepath}
                  disabled={savingFilepath}
                  className="p-1 text-muted hover:text-white disabled:opacity-50"
                  title="Cancel"
                >
                  <XCircle className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : filepath ? (
              <div className="mt-2 flex items-center gap-1.5">
                <Folder className="w-3.5 h-3.5 text-muted flex-shrink-0" />
                <button
                  onClick={copyFilepathToClipboard}
                  title={`${filepath}\n\nClick to copy`}
                  className="min-w-0 truncate text-left text-xs font-mono text-cyan-400 hover:text-cyan-300 hover:underline transition-colors"
                >
                  {filepath}
                </button>
                {canEditFilepath && (
                  <button
                    onClick={startEditFilepath}
                    className="p-1 text-muted hover:text-white transition-colors flex-shrink-0"
                    title="Edit filepath"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                )}
                {filepathFlash && (
                  <span className="text-[10px] text-cyan-400 flex-shrink-0">{filepathFlash}</span>
                )}
              </div>
            ) : canEditFilepath ? (
              <button
                onClick={startEditFilepath}
                className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 text-[11px] text-muted hover:text-cyan-400 border border-dashed border-zinc-700 hover:border-cyan-500/40 transition-colors"
              >
                <Plus className="w-3 h-3" />
                Add Filepath
              </button>
            ) : null}

            {filepathError && (
              <p className="mt-1 text-[11px] text-red-400">{filepathError}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-muted hover:text-white hover:bg-zinc-800 transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Note history */}
        <div ref={notesListRef} className="relative z-10 flex-1 overflow-y-auto min-h-0 p-5 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 text-muted animate-spin" />
            </div>
          ) : notes.length === 0 ? (
            <p className="text-sm text-muted text-center py-8">No notes yet. Add the first one below.</p>
          ) : (
            notes.map(entry => {
              const isOwner = user?.id === entry.authorId;
              const isEditing = editingNoteId === entry.id;
              const isDeleting = deletingNoteId === entry.id;
              const isPinned = !!onPinNote && entry.id === effectivePinnedId;

              return (
                <div
                  key={entry.id}
                  className={`bg-zinc-800/50 border p-4 ${isPinned ? 'border-cyan-500/40' : 'border-zinc-700/40'}`}
                >
                  <div className="flex items-center justify-between mb-2 gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-medium text-cyan-400">{entry.authorName}</span>
                      <span className="text-muted text-xs">·</span>
                      <span className="text-xs text-muted">{formatNoteDate(entry.createdAt)}</span>
                      {isPinned && (
                        <span className="text-[10px] font-medium text-cyan-400 border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 flex-shrink-0">
                          On panel
                        </span>
                      )}
                    </div>
                    {!isEditing && (onPinNote || (isOwner && !readOnly)) && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {onPinNote && (
                          <button
                            onClick={() => onPinNote(entry.id)}
                            className={`p-1 transition-colors ${isPinned ? 'text-cyan-400' : 'text-muted hover:text-cyan-400'}`}
                            title={isPinned ? 'Shown on the panel' : 'Show this note on the panel'}
                          >
                            <Pin className="w-3.5 h-3.5" fill={isPinned ? 'currentColor' : 'none'} />
                          </button>
                        )}
                        {isOwner && !readOnly && (
                          <>
                            <button
                              onClick={() => startEdit(entry)}
                              className="p-1 text-muted hover:text-muted transition-colors"
                              title="Edit note"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteNote(entry.id)}
                              disabled={isDeleting}
                              className="p-1 text-muted hover:text-red-400 transition-colors disabled:opacity-50"
                              title="Delete note"
                            >
                              {isDeleting
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <Trash2 className="w-3.5 h-3.5" />
                              }
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {isEditing ? (
                    <div className="space-y-2">
                      <RichTextEditor
                        value={editText}
                        onChange={setEditText}
                        onCtrlEnter={() => handleSaveEdit(entry.id)}
                        minHeight="4.5rem"
                        maxHeight="30vh"
                        autoFocus
                      />
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          onClick={cancelEdit}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted hover:text-white transition-colors"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          Cancel
                        </button>
                        <button
                          onClick={() => handleSaveEdit(entry.id)}
                          disabled={!editText.trim() || savingEdit}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-cyan-600/20 text-cyan-400 hover:bg-cyan-600/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {savingEdit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <RichTextDisplay html={entry.noteText} />
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Add new note (hidden for read-only users) */}
        {readOnly ? (
          <div className="relative z-10 px-5 pt-3 pb-5 border-t border-zinc-800/50 flex-shrink-0 flex items-center justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-muted hover:text-white transition-colors"
            >
              Close
            </button>
          </div>
        ) : (
          <div className="relative z-10 px-5 pt-3 pb-5 border-t border-zinc-800/50 flex-shrink-0 space-y-3">
            <RichTextEditor
              value={newText}
              onChange={setNewText}
              onCtrlEnter={handleAddNote}
              placeholder="Add a new note... (Ctrl+Enter to save)"
              minHeight="6rem"
              maxHeight="35vh"
              autoFocus={!loading}
            />
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-muted hover:text-white transition-colors"
              >
                Close
              </button>
              <button
                onClick={handleAddNote}
                disabled={!newText || saving}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-all ${
                  newText && !saving
                    ? 'bg-gradient-to-r from-blue-600 to-cyan-500 text-white hover:from-blue-500 hover:to-cyan-400'
                    : 'bg-zinc-800 text-muted cursor-not-allowed'
                }`}
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                Add Note
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default NotesModal;
