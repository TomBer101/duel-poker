import { useEffect, useState } from "react";
import {
  type DragEndEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";

/** How long an "illegal drop" hint stays on screen. */
const HINT_MS = 2600;

const ILLEGAL_HINT =
  "Fill your shortest hands first — drop it on one of the highlighted columns.";

export type DragPlacement = {
  /** A card is currently being dragged. */
  dragging: boolean;
  /** Transient message shown after an illegal drop; `null` when clear. */
  hint: string | null;
  dismissHint: () => void;
  sensors: ReturnType<typeof useSensors>;
  onDragStart: () => void;
  onDragEnd: (event: DragEndEvent) => void;
  onDragCancel: () => void;
};

/**
 * Drag-to-place wiring for the drawn card. Legal targets are only known to the
 * board while `dragging` is true, and dropping on a non-legal hand raises a
 * short hint rather than silently snapping back.
 *
 * Droppable ids are `hand-<index>`; a drop anywhere else on the table is a
 * quiet no-op (the card snaps home).
 */
export function useDragPlacement(opts: {
  legalHands: number[];
  onPlace: (handIndex: number) => void;
}): DragPlacement {
  const { legalHands, onPlace } = opts;
  const [dragging, setDragging] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    if (!hint) return;
    const id = setTimeout(() => setHint(null), HINT_MS);
    return () => clearTimeout(id);
  }, [hint]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 140, tolerance: 8 },
    }),
  );

  function onDragStart() {
    setHint(null);
    setDragging(true);
  }

  function onDragEnd(event: DragEndEvent) {
    setDragging(false);
    const over = event.over?.id;
    if (typeof over !== "string" || !over.startsWith("hand-")) return;
    const index = Number(over.slice("hand-".length));
    if (legalHands.includes(index)) {
      onPlace(index);
    } else {
      setHint(ILLEGAL_HINT);
    }
  }

  function onDragCancel() {
    setDragging(false);
  }

  return {
    dragging,
    hint,
    dismissHint: () => setHint(null),
    sensors,
    onDragStart,
    onDragEnd,
    onDragCancel,
  };
}
