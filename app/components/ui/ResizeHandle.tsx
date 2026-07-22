'use client';

import type { PointerEvent as ReactPointerEvent } from 'react';

interface ResizeHandleProps {
  startResize: (e: ReactPointerEvent) => void;
  /** Double-click resets the panel to its original size. */
  resetSize?: () => void;
}

/**
 * Bottom-right corner grip for resizing a modal panel. Pair with
 * `useResizableModal` and place inside a `relative`/`absolute`-positioned panel.
 * Double-click resets to the original size.
 */
export function ResizeHandle({ startResize, resetSize }: ResizeHandleProps) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize (double-click to reset)"
      title="Drag to resize · double-click to reset"
      onPointerDown={startResize}
      onDoubleClick={resetSize}
      className="absolute bottom-0 right-0 z-20 w-4 h-4 cursor-se-resize touch-none text-zinc-600 hover:text-zinc-400 transition-colors"
    >
      <svg viewBox="0 0 10 10" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round">
        <path d="M9 3 L3 9 M9 6 L6 9" />
      </svg>
    </div>
  );
}
