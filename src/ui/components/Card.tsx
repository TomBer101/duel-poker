import { motion, useReducedMotion } from "motion/react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useRef, useState } from "react";
import type { Card as CardT, Suit } from "../../engine/types";
import { cn } from "../cn";
import { rankLabel, SUIT_META } from "../format";
import styles from "./Card.module.css";

export type CardSize = "sm" | "md" | "lg";

/** Touch-and-hold duration before an `interactive` card enlarges. */
const LONG_PRESS_MS = 2000;

export type CardProps = {
  /**
   * The card to show face-up. Omit it entirely for a card whose value the
   * viewer is not allowed to know (the opponent's hidden 5th card) — nothing
   * about it then reaches the DOM.
   */
  card?: CardT;
  /** Show the back even though `card` is known — used for a card genuinely
   *  unrevealed to this viewer (the opponent's 5th, before reveal). */
  faceDown?: boolean;
  /**
   * This is the viewer's own card that the *opponent* can't see (their 5th,
   * pre-reveal). The viewer still sees its face — only a small badge marks it
   * as hidden from the other side. Owners always know their own cards; only
   * `faceDown` (without `mine`) hides a value from the viewer entirely.
   */
  mine?: boolean;
  size?: CardSize;
  /** Enlarge on hover (desktop) / a ~2s touch-and-hold (mobile). */
  interactive?: boolean;
  className?: string;
  /** Override the computed accessible label. */
  ariaLabel?: string;
};

/**
 * A single playing card. Three visual states:
 * - face-up: `card` given, `faceDown` false — rank + suit in the deck's colours.
 * - your own hidden-from-opponent card: `card` + `mine` — shown face-up to you,
 *   with a small badge; `faceDown` stays false since you can see it.
 * - unknown-to-viewer card: no `card` (or `faceDown` with no `mine`) — plain back.
 *
 * Front and back are both mounted on a 3D-flipped container, so the reveal
 * sequence gets a real flip just by animating `faceDown` to false.
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
  const [pressed, setPressed] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const label = ariaLabel ?? computeLabel(card, showBack, mine);

  const frontStyle: CSSProperties | undefined = card
    ? ({ "--suit": `var(${SUIT_META[card.suit].cssVar})` } as CSSProperties)
    : undefined;

  // Hover enlarges via CSS alone; touch has no hover state, so a hold past
  // LONG_PRESS_MS toggles the same enlarged look via `.pressed`.
  function onPointerDown(e: ReactPointerEvent) {
    if (!interactive || e.pointerType !== "touch") return;
    pressTimer.current = setTimeout(() => setPressed(true), LONG_PRESS_MS);
  }
  function endPress() {
    clearTimeout(pressTimer.current);
    setPressed(false);
  }

  return (
    <div
      className={cn(
        styles.card,
        size === "sm" && styles.sm,
        size === "lg" && styles.lg,
        interactive && styles.interactive,
        pressed && styles.pressed,
        className,
      )}
      role="img"
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerUp={endPress}
      onPointerLeave={endPress}
      onPointerCancel={endPress}
    >
      <motion.div
        className={styles.flip}
        initial={false}
        animate={{ rotateY: showBack ? 180 : 0 }}
        transition={
          reduceMotion ? { duration: 0 } : { duration: 0.45, ease: [0.4, 0, 0.2, 1] }
        }
      >
        <div className={cn(styles.face, styles.faceFront)} style={frontStyle}>
          {card && <Face rank={card.rank} suit={card.suit} />}
          {mine && !showBack && (
            <span
              className={styles.badge}
              aria-hidden="true"
              title="Hidden from your opponent"
            >
              🔒
            </span>
          )}
        </div>
        <div className={cn(styles.face, styles.faceBack)}>
          {mine && showBack && (
            <span className={styles.badge} aria-hidden="true">
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

function computeLabel(card: CardT | undefined, showBack: boolean, mine: boolean): string {
  if (!card) return "hidden card";
  if (mine) return `your ${describe(card)} (hidden from your opponent)`;
  return showBack ? "hidden card" : describe(card);
}

function Face({ rank, suit }: { rank: number; suit: Suit }) {
  const r = rankLabel(rank);
  const s = SUIT_META[suit].glyph;
  return (
    <>
      <span className={cn(styles.corner, styles.cornerTl)}>
        <span className={styles.rank}>{r}</span>
        <span className={styles.suit} aria-hidden="true">
          {s}
        </span>
      </span>
      <span className={styles.pip} aria-hidden="true">
        {s}
      </span>
      <span className={cn(styles.corner, styles.cornerBr)} aria-hidden="true">
        <span className={styles.rank}>{r}</span>
        <span className={styles.suit}>{s}</span>
      </span>
    </>
  );
}
