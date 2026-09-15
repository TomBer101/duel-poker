import type { PlacedCard } from "../../engine/types";
import { cn } from "../cn";
import { Card } from "./Card";
import styles from "./Hand.module.css";

export type HandProps = {
  /** 0–5 placed cards, in the order they were played. */
  cards: PlacedCard[];
  /** Whose hand this is — decides whether a face-down card's value is shown. */
  owner: "you" | "opp";
  size?: "sm" | "md";
  /** Fill-evenly: this hand can legally receive the next card. */
  legal?: boolean;
  /** A drag is in progress and this hand is not a legal target. */
  muted?: boolean;
  /** A dragged card is currently hovering this hand. */
  dropActive?: boolean;
  /** Reveal-phase: show the opponent's face-down card face-up. */
  reveal?: boolean;
  className?: string;
};

/**
 * One of a player's five hands, drawn as a downward fan: each card slides up
 * over the previous one so only its top strip (rank + suit) stays visible.
 * The column always reserves its full five-card height so the board never
 * shifts as cards land. Every card is `interactive` — hover (or a touch-and-
 * hold) enlarges it, useful both for the compact opponent row and for a card
 * buried under later ones in your own fan.
 */
export function Hand({
  cards,
  owner,
  size = "md",
  legal,
  muted,
  dropActive,
  reveal,
  className,
}: HandProps) {
  return (
    <div
      className={cn(
        styles.hand,
        size === "sm" && styles.sm,
        legal && styles.legal,
        muted && styles.muted,
        dropActive && styles.dropActive,
        className,
      )}
      data-legal={legal || undefined}
      data-drop-active={dropActive || undefined}
    >
      {cards.map((pc, i) => {
        if (pc.faceUp) {
          return <Card key={i} card={pc.card} size={size} interactive />;
        }
        // Your own face-down card: you can always see it (you decide whether
        // to replace it), the opponent never can. The reveal phase flips the
        // opponent's the same way once its index is revealed.
        if (owner === "you") {
          return <Card key={i} card={pc.card} mine size={size} interactive />;
        }
        if (reveal && pc.card) {
          return <Card key={i} card={pc.card} size={size} interactive />;
        }
        return <Card key={i} faceDown size={size} interactive />;
      })}
    </div>
  );
}
