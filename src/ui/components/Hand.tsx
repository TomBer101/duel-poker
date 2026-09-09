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
  /** Reveal-phase: show this hand's face-down card face-up. */
  reveal?: boolean;
  className?: string;
};

/**
 * One of a player's five hands, drawn as a downward fan: each card slides up
 * over the previous one so only its top strip (rank + suit) stays visible.
 * The column always reserves its full five-card height so the board never
 * shifts as cards land.
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
          return <Card key={i} card={pc.card} size={size} />;
        }
        // The reveal flips every face-down card that has a known value.
        if (reveal && pc.card) {
          return <Card key={i} card={pc.card} size={size} />;
        }
        // Face-down: your own card shows a lock (value still in its a11y
        // label); the opponent's value must never reach the DOM.
        return owner === "you" ? (
          <Card key={i} card={pc.card} faceDown mine size={size} />
        ) : (
          <Card key={i} faceDown size={size} />
        );
      })}
    </div>
  );
}
