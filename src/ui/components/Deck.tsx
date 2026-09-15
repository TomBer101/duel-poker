import { cn } from "../cn";
import styles from "./Deck.module.css";

export type DeckProps = {
  cardsLeft: number;
  /** The local player may draw right now — the pile becomes clickable. */
  canDraw?: boolean;
  onDraw?: () => void;
  className?: string;
};

/**
 * The draw pile: a card count, clickable to draw when it's your moment to.
 * A real `<button>` (not a click handler on a div) so it's reachable and
 * actionable from the keyboard, not just drag-and-drop.
 */
export function Deck({ cardsLeft, canDraw = false, onDraw, className }: DeckProps) {
  return (
    <div className={cn(styles.wrap, className)}>
      <button
        type="button"
        className={cn(styles.deck, canDraw && styles.canDraw)}
        disabled={!canDraw}
        onClick={onDraw}
        aria-label={
          canDraw
            ? `Draw pile, ${cardsLeft} cards left — tap to draw`
            : `Draw pile, ${cardsLeft} cards left`
        }
      >
        {cardsLeft}
      </button>
      {canDraw && <span className={styles.hint}>tap to draw</span>}
    </div>
  );
}
