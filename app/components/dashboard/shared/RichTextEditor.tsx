'use client';

import React, { useEffect, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  onCtrlEnter?: () => void;
  placeholder?: string;
  minHeight?: string;
  maxHeight?: string;
  autoFocus?: boolean;
}

const RichTextEditor: React.FC<RichTextEditorProps> = ({
  value,
  onChange,
  onCtrlEnter,
  placeholder = 'Add a note...',
  minHeight = '6rem',
  maxHeight,
  autoFocus = false,
}) => {
  const [isEmpty, setIsEmpty] = useState(!value);

  const editor = useEditor({
    extensions: [StarterKit],
    content: value,
    autofocus: autoFocus,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'focus:outline-none',
      },
      handleKeyDown: (_view, event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault();
          onCtrlEnter?.();
          return true;
        }
        return false;
      },
    },
    onUpdate({ editor }) {
      setIsEmpty(editor.isEmpty);
      const html = editor.isEmpty ? '' : editor.getHTML();
      onChange(html);
    },
  });

  // Sync external value changes (e.g. reset after save). `setContent` emits
  // an `update` event by default, so `onUpdate` above takes care of keeping
  // `isEmpty` in sync — no setState needed here.
  useEffect(() => {
    if (!editor) return;
    const current = editor.isEmpty ? '' : editor.getHTML();
    if (value !== current) {
      editor.commands.setContent(value || '');
    }
  }, [value, editor]);

  return (
    <div
      className="relative w-full px-3 py-2.5 bg-zinc-800/50 border border-zinc-700/50 text-sm text-white
        focus-within:ring-1 focus-within:ring-cyan-500/50 focus-within:border-cyan-500/50
        transition-colors cursor-text overflow-y-auto
        [&_.tiptap_ul]:list-disc [&_.tiptap_ul]:pl-5
        [&_.tiptap_ol]:list-decimal [&_.tiptap_ol]:pl-5
        [&_.tiptap_li]:my-0.5
        [&_.tiptap_li>ul]:mt-1 [&_.tiptap_li>ul]:list-[circle]
        [&_.tiptap_li>ol]:mt-1
        [&_.tiptap_p]:leading-relaxed"
      style={{ minHeight, maxHeight }}
      onClick={() => editor?.commands.focus()}
    >
      {isEmpty && (
        <span className="absolute top-2.5 left-3 text-muted pointer-events-none select-none">
          {placeholder}
        </span>
      )}
      <EditorContent editor={editor} />
    </div>
  );
};

export default RichTextEditor;
