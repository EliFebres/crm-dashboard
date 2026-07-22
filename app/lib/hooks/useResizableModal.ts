'use client';

import { useCallback, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

const MIN_SCALE = 0.6;
const MAX_SCALE = 3;
const MAX_VW = 0.95;
const MAX_VH = 0.95;

function storageKey(key: string) {
  return `crm-modal-size-${key}`;
}

function loadScale(key: string): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Only a numeric `scale` counts; older `{width,height}` entries are ignored
    // (a one-time reset for anyone who resized under the previous model).
    if (typeof parsed?.scale === 'number' && parsed.scale > 0) return parsed.scale;
    return null;
  } catch {
    return null;
  }
}

function saveScale(key: string, scale: number) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(storageKey(key), JSON.stringify({ scale }));
  } catch {
    /* ignore */
  }
}

function clearScale(key: string) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(storageKey(key));
  } catch {
    /* ignore */
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

// Largest zoom that keeps a panel of the given unzoomed base size within ~95%
// of the viewport in both axes.
function maxScaleFor(baseW: number, baseH: number) {
  if (baseW <= 0 || baseH <= 0) return MAX_SCALE;
  return Math.min((window.innerWidth * MAX_VW) / baseW, (window.innerHeight * MAX_VH) / baseH, MAX_SCALE);
}

/**
 * Makes a modal panel proportionally zoomable (drag the corner grip to scale the
 * whole modal — text, boxes, and spacing together) and remembers the zoom level
 * in localStorage (per browser, keyed per modal). Mirrors the SSR-guarded
 * load/save shape in `useAlerts.ts`.
 *
 * Until the user drags (and unless a saved zoom exists), `panelStyle` is
 * `undefined` so the panel keeps its original CSS-class sizing — i.e. it looks
 * exactly as it did before. CSS `zoom` (not `transform: scale`) scales the panel
 * and its contents while preserving layout/centering/scroll and keeping the
 * Tiptap editor's caret aligned; the panel's own `max-w-*`/`max-h-*` classes
 * define the base that `zoom` multiplies, so proportions are preserved.
 *
 * These modals always start closed, so the saved zoom is read lazily on first
 * render (SSR-safe: `loadScale` returns null without `window`) — no mount effect,
 * and no hydration mismatch since nothing is rendered until the modal opens.
 */
export function useResizableModal(key: string) {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  // `null` = untouched → the panel's own Tailwind classes govern its size.
  const [scale, setScale] = useState<number | null>(() => loadScale(key));

  // Callback ref: measure on open and clamp a restored zoom to the *current*
  // viewport (handles reloading into a smaller window). Runs once per open since
  // the node identity is stable while the modal stays mounted.
  const panelRef = useCallback((node: HTMLDivElement | null) => {
    nodeRef.current = node;
    if (!node) return;
    setScale((cur) => {
      if (cur == null) return cur;
      const rect = node.getBoundingClientRect(); // rendered (zoomed) size = base · cur
      const clamped = clamp(cur, MIN_SCALE, maxScaleFor(rect.width / cur, rect.height / cur));
      return clamped === cur ? cur : clamped;
    });
  }, []);

  const startResize = useCallback((e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startScale = scale ?? 1;
    // Measure the panel's current (zoomed) rendered size once, then divide out
    // the current zoom to get the unzoomed base — the size at scale 1.
    const rect = nodeRef.current?.getBoundingClientRect();
    const startVisualW = rect?.width ?? 0;
    const startVisualH = rect?.height ?? 0;
    const startX = e.clientX;
    const startY = e.clientY;
    const maxScale = maxScaleFor(startVisualW / startScale, startVisualH / startScale);

    const onMove = (ev: PointerEvent) => {
      if (!startVisualW || !startVisualH) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      // Center-anchored: each edge moves half the size delta, so the corner
      // tracks the cursor when the visual size grows by 2·d. Average the two
      // axes' implied ratios so a diagonal drag feels natural.
      const next = startScale * (1 + dx / startVisualW + dy / startVisualH);
      setScale(clamp(next, MIN_SCALE, maxScale));
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.userSelect = '';
      setScale((current) => {
        if (current != null) saveScale(key, current);
        return current;
      });
    };

    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [key, scale]);

  // Revert to the panel's original (class-based) size and forget the saved zoom.
  const resetSize = useCallback(() => {
    clearScale(key);
    setScale(null);
  }, [key]);

  // `zoom` scales the panel and its contents uniformly; the base size (and thus
  // the proportion) comes from the panel's own max-w-*/max-h-* classes.
  const panelStyle: CSSProperties | undefined = scale != null ? { zoom: scale } : undefined;

  return { panelRef, panelStyle, startResize, resetSize };
}
