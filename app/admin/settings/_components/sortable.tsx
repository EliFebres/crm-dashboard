'use client';

/**
 * Small drag-to-reorder helpers shared by the Settings registry tables
 * (Project Types, Intake Types, Teams, Offices).
 *
 * `DndContext` renders an inline hidden accessibility `<div>`, so it must wrap the
 * whole table (NOT sit inside `<tbody>`, which would be invalid HTML). Use
 * {@link SortableList} around the table/card and {@link SortableBody} inside the
 * `<tbody>` around the rows — `SortableContext` emits no DOM, so it's safe there.
 * Each row ({@link SortableRow}) gets a leading drag-handle cell.
 */
import React from 'react';
import { GripVertical } from 'lucide-react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/**
 * Provides the drag context for a reorderable table. Wrap the table (or its
 * card) with this — never place it inside `<tbody>`. `ids` is the current row
 * order; `onReorder` fires with the next order (already run through `arrayMove`)
 * on drop.
 */
export function SortableList({
  ids,
  onReorder,
  children,
}: {
  ids: string[];
  onReorder: (nextIds: string[]) => void;
  children: React.ReactNode;
}) {
  const sensors = useSensors(
    // A small distance threshold so a click on the handle doesn't start a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    onReorder(arrayMove(ids, from, to));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      {children}
    </DndContext>
  );
}

/**
 * Groups the sortable rows. Place directly inside `<tbody>` around the
 * {@link SortableRow}s — it renders a context provider only, no DOM.
 */
export function SortableBody({ ids, children }: { ids: string[]; children: React.ReactNode }) {
  return (
    <SortableContext items={ids} strategy={verticalListSortingStrategy}>
      {children}
    </SortableContext>
  );
}

/**
 * A draggable table row. Renders a leading drag-handle `<td>` then the caller's
 * cells (`children`). Pass `disabled` (e.g. while the row is being edited) to
 * lock the handle. The `<th className="w-8" />` and `colSpan` on placeholder
 * rows must account for the extra handle column.
 */
export function SortableRow({
  id,
  disabled = false,
  className,
  children,
}: {
  id: string;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined,
    position: isDragging ? 'relative' : undefined,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <tr ref={setNodeRef} style={style} className={className}>
      <td className="pl-3 pr-0 py-3 w-8 align-middle">
        <button
          type="button"
          className={
            disabled
              ? 'p-1 text-zinc-700 cursor-not-allowed'
              : 'p-1 text-muted hover:text-zinc-300 cursor-grab active:cursor-grabbing touch-none'
          }
          title={disabled ? 'Finish editing to reorder' : 'Drag to reorder'}
          aria-label="Drag to reorder"
          {...(disabled ? {} : attributes)}
          {...(disabled ? {} : listeners)}
        >
          <GripVertical className="w-4 h-4" />
        </button>
      </td>
      {children}
    </tr>
  );
}
