import { useDraggable } from "@dnd-kit/core";
import type { Card as CardT } from "../../engine/types";
import { cn } from "../cn";
import { Card } from "./Card";
import styles from "./DrawnCard.module.css";

export const DRAWN_CARD_ID = "drawn-card";

export type DrawnCardProps = {
  card: CardT;
  size?: "md" | "lg";
  /** Not the local player's moment to place — show it but don't let it drag. */
  disabled?: boolean;
};

/**
 * The card the local player has just drawn, staged and waiting to be placed.
 * It is the single draggable source; {@link useDragPlacement} turns a drop on
 * a hand into a placement. Mode-agnostic — it has no notion of who or what the
 * opponent is.
 */
export function DrawnCard({ card, size = "md", disabled }: DrawnCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: DRAWN_CARD_ID,
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(styles.drawn, isDragging && styles.dragging)}
      {...listeners}
      {...attributes}
    >
      <Card card={card} size={size} interactive={!disabled} />
      {!disabled && <span className={styles.caption}>drag to a hand</span>}
    </div>
  );
}
