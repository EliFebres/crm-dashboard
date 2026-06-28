'use client';

import React, { useState, useEffect, useRef, ReactNode } from 'react';
import { X, Plus, Loader2, Pencil, Trash2, Check, XCircle } from 'lucide-react';
import { getCompetitiveFundNotes, addCompetitiveFundNote, updateCompetitiveFundNote, deleteCompetitiveFundNote } from '@/app/lib/api/competitive';
import { useCurrentUser } from '@/app/lib/auth/context';
import type { CompetitiveNoteEntry } from '@/app/lib/types/competitive';
import RichTextEditor from '@/app/components/dashboard/shared/RichTextEditor';
import RichTextDisplay from '@/app/components/dashboard/shared/RichTextDisplay';

interface CompetitiveNotesModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle: ReactNode;
  fundId: string;
  onNoteAdded?: () => void;
  onNoteDeleted?: () => void;
}

function formatNoteDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const CompetitiveNotesModal: React.FC<CompetitiveNotesModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  fundId,
  onNoteAdded,
  onNoteDeleted,
}) => {
  const { user } = useCurrentUser();
  const notesListRef = useRef<HTMLDivElement>(null);
  const [notes, setNotes] = useState<CompetitiveNoteEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [newText, setNewText] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingNoteId, setDeletingNoteId] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen || !fundId) return;
    setLoading(true);
    setNewText('');
    setEditingNoteId(null);
    getCompetitiveFundNotes(fundId)
      .then(setNotes)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [isOpen, fundId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleAddNote = async () => {
    if (!newText.trim() || saving) return;
    setSaving(true);
    try {
      const entry = await addCompetitiveFundNote(fundId, newText.trim());
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

  const startEdit = (entry: CompetitiveNoteEntry) => {
    setEditingNoteId(entry.id);
    setEditText(entry.noteText);
  };

  const cancelEdit = () => {
    setEditingNoteId(null);
    setEditText('');
  };

  const handleSaveEdit = async (noteId: number) => {
    if (!editText.trim() || savingEdit) return;
    setSavingEdit(true);
    try {
      const updated = await updateCompetitiveFundNote(fundId, noteId, editText.trim());
      setNotes(prev => prev.map(n => n.id === noteId ? updated : n));
      setEditingNoteId(null);
      setEditText('');
    } catch (err) {
      console.error('Failed to update note:', err);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteNote = async (noteId: number) => {
    setDeletingNoteId(noteId);
    try {
      await deleteCompetitiveFundNote(fundId, noteId);
      setNotes(prev => prev.filter(n => n.id !== noteId));
      onNoteDeleted?.();
    } catch (err) {
      console.error('Failed to delete note:', err);
    } finally {
      setDeletingNoteId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />

      <div className="relative w-full max-w-2xl bg-zinc-900 border border-zinc-700/50 shadow-2xl flex flex-col max-h-[85vh]">
        <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] via-transparent to-transparent pointer-events-none" />
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent" />

        <div className="relative z-10 px-5 py-4 border-b border-zinc-800/50 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-base font-medium text-white">{title}</h2>
            <p className="text-xs text-muted mt-0.5">{subtitle}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-muted hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

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

              return (
                <div key={entry.id} className="bg-zinc-800/50 border border-zinc-700/40 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-cyan-400">{entry.authorName}</span>
                      <span className="text-muted text-xs">&middot;</span>
                      <span className="text-xs text-muted">{formatNoteDate(entry.createdAt)}</span>
                    </div>
                    {isOwner && !isEditing && (
                      <div className="flex items-center gap-1">
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

        <div className="relative z-10 px-5 pt-3 pb-5 border-t border-zinc-800/50 flex-shrink-0 space-y-3">
          <RichTextEditor
            value={newText}
            onChange={setNewText}
            onCtrlEnter={handleAddNote}
            placeholder="Add a note... (Ctrl+Enter to save)"
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
      </div>
    </div>
  );
};

export default CompetitiveNotesModal;
