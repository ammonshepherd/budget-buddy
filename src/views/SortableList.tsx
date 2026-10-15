import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";
import { GripIcon } from "./icons";

/** Items only move up and down. */
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/**
 * A list reordered by dragging each row's handle (the six dots on the left),
 * with a mouse, a finger, or the keyboard (focus the handle, Space to pick up,
 * arrows to move, Space to drop). `onReorder` gets every id in the new order.
 */
export function SortableList<T extends { id: string; name: string }>({
  label,
  items,
  onReorder,
  children,
}: {
  label: string;
  items: T[];
  onReorder: (ids: string[]) => void;
  /** The rest of the row, right of the handle. */
  children: (item: T) => ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = items.map((item) => item.id);
  const nameOf = (id: string | number) => items.find((item) => item.id === id)?.name ?? "";
  const placeOf = (id: string | number) =>
    `position ${ids.indexOf(String(id)) + 1} of ${ids.length}`;

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    onReorder(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[verticalOnly]}
      onDragEnd={onDragEnd}
      accessibility={{
        // What a screen reader hears while moving a row.
        announcements: {
          onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}, ${placeOf(active.id)}.`,
          onDragOver: ({ active, over }) =>
            over ? `${nameOf(active.id)} moved to ${placeOf(over.id)}.` : undefined,
          onDragEnd: ({ active, over }) =>
            over ? `${nameOf(active.id)} dropped at ${placeOf(over.id)}.` : undefined,
          onDragCancel: ({ active }) => `Moving ${nameOf(active.id)} was cancelled.`,
        },
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className="item-list sortable-list" aria-label={label}>
          {items.map((item) => (
            <SortableRow key={item.id} id={item.id} name={item.name}>
              {children(item)}
            </SortableRow>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({ id, name, children }: { id: string; name: string; children: ReactNode }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      className={isDragging ? "sortable-row dragging" : "sortable-row"}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <button
        ref={setActivatorNodeRef}
        className="drag-handle"
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Move ${name}`}
      >
        <GripIcon />
      </button>
      {children}
    </li>
  );
}
