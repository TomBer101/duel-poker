import { motion, useReducedMotion } from "motion/react";
import type { CSSProperties } from "react";
import type { Card as CardT, Suit } from "../../engine/types";
import { rankLabel, SUIT_META } from "../format";

export type CardSize = "sm" | "md" | "lg";

export type CardProps = {
  /**
   * The card to show face-up. Omit it entirely for a card whose value the
   * viewer is not allowed to know (the opponent's hidden 5th card) — nothing
   * about it then reaches the DOM.
   */
  card?: CardT;
  /** Show the back even though `card` is known (your own face-down 5th card). */
  faceDown?: boolean;
  /** This is the viewer's own hidden card — adds a lock badge to the back. */
  mine?: boolean;
  size?: CardSize;
  /** Grow on hover / focus. Off by default; on for the player's live hands. */
  interactive?: boolean;
  className?: string;
  /** Override the computed accessible label. */
  ariaLabel?: string;
};

/**
 * A single playing card. Three visual states:
 * - face-up: `card` given, `faceDown` false — rank + suit in the viewer's
 *   four-colour scheme (♠ ink, ♥ red, ♦ blue, ♣ green).
 * - your hidden card: `card` given, `faceDown` + `mine` — back with a lock.
 * - unknown card: no `card` — plain back.
 *
 * Front and back are both mounted on a 3D-flipped container so the reveal
 * sequence can animate `faceDown` false and get a real flip for free.
 */
export function Card({
  card,
  faceDown = false,
  mine = false,
  size = "md",
  interactive = false,
  className,
  ariaLabel,
}: CardProps) {
  const reduceMotion = useReducedMotion();
  const showBack = faceDown || !card;

  const label =
    ariaLabel ??
    (showBack
      ? mine && card
        ? `your face-down ${describe(card)}`
        : "hidden card"
      : describe(card!));

  const frontStyle: CSSProperties | undefined = card
    ? ({ "--suit": `var(${SUIT_META[card.suit].cssVar})` } as CSSProperties)
    : undefined;

  return (
    <div
      className={[
        "card",
        `card--${size}`,
        interactive && "card--interactive",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      role="img"
      aria-label={label}
    >
      <motion.div
        className="card__flip"
        initial={false}
        animate={{ rotateY: showBack ? 180 : 0 }}
        transition={
          reduceMotion
            ? { duration: 0 }
            : { duration: 0.45, ease: [0.4, 0, 0.2, 1] }
        }
      >
        <div className="card__face card__face--front" style={frontStyle}>
          {card && <Face rank={card.rank} suit={card.suit} />}
        </div>
        <div className="card__face card__face--back">
          {mine && (
            <span className="card__badge" aria-hidden="true">
              🔒
            </span>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function describe(card: CardT): string {
  return `${rankLabel(card.rank)} of ${card.suit}`;
}

function Face({ rank, suit }: { rank: number; suit: Suit }) {
  const r = rankLabel(rank);
  const s = SUIT_META[suit].glyph;
  return (
    <>
      <span className="card__corner card__corner--tl">
        <span className="card__rank">{r}</span>
        <span className="card__suit" aria-hidden="true">
          {s}
        </span>
      </span>
      <span className="card__pip" aria-hidden="true">
        {s}
      </span>
      <span className="card__corner card__corner--br" aria-hidden="true">
        <span className="card__rank">{r}</span>
        <span className="card__suit">{s}</span>
      </span>
    </>
  );
}
