import { useDroppable } from "@dnd-kit/core";
import type { ReactNode } from "react";
import type { GameState, Hand as HandT } from "../../engine/types";
import { AI, HUMAN } from "../hooks/useSoloGame";
import { Hand } from "./Hand";
import styles from "./Board.module.css";

export type BoardProps = {
  state: GameState;
  /** Hand indices the pending card may legally land on. */
  legalHands?: number[];
  /** A card is being dragged — light legal targets, dim the rest. */
  dragging?: boolean;
  /** Opponent hands with index < this render face-up (reveal sequence). */
  reveal?: number;
  /** Action content shown beside the draw pile — the draw button or drawn card. */
  children?: ReactNode;
};

function turnText(state: GameState): string {
  switch (state.phase) {
    case "placing":
    case "replace":
      return state.turn === HUMAN ? "Your turn" : "Opponent thinking…";
    case "reveal":
      return "Revealing…";
    case "result":
      return "Game over";
    default:
      return "";
  }
}

/**
 * The whole table: the opponent's five hands on top (compact), a centre strip
 * with the draw pile and turn text, and your five hands below. Your hands are
 * drop targets — the legal ones light up only while a card is being dragged.
 */
export function Board({
  state,
  legalHands = [],
  dragging = false,
  reveal = 0,
  children,
}: BoardProps) {
  const cardsLeft = 52 - state.drawCount;

  return (
    <div className={styles.board}>
      <section className={styles.row} aria-label="Opponent's hands">
        {state.hands[AI].map((hand, i) => (
          <Hand
            key={i}
            cards={hand.cards}
            owner="opp"
            size="sm"
            reveal={i < reveal}
          />
        ))}
      </section>

      <div className={styles.center}>
        <div
          className={styles.deck}
          aria-label={`Draw pile, ${cardsLeft} cards left`}
        >
          {cardsLeft}
        </div>
        {children && <div className={styles.action}>{children}</div>}
        <p className={styles.turn}>{turnText(state)}</p>
      </div>

      <section className={styles.row} aria-label="Your hands">
        {state.hands[HUMAN].map((hand, i) => (
          <DropHand
            key={i}
            index={i}
            hand={hand}
            legal={legalHands.includes(i)}
            dragging={dragging}
          />
        ))}
      </section>
    </div>
  );
}

function DropHand({
  index,
  hand,
  legal,
  dragging,
}: {
  index: number;
  hand: HandT;
  legal: boolean;
  dragging: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `hand-${index}` });
  return (
    <div ref={setNodeRef} className={styles.drop}>
      <Hand
        cards={hand.cards}
        owner="you"
        legal={dragging && legal}
        muted={dragging && !legal}
        dropActive={dragging && legal && isOver}
      />
    </div>
  );
}
