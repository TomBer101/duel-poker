import { useDroppable } from "@dnd-kit/core";
import type { ReactNode } from "react";
import { otherPlayer } from "../../engine/deck";
import type { GameState, Hand as HandT, PlayerId } from "../../engine/types";
import { Deck } from "./Deck";
import { Hand, type HandProps } from "./Hand";
import { Timer } from "./Timer";
import styles from "./Board.module.css";

export type BoardProps = {
  state: GameState;
  /** Which seat this client is looking from — bottom row, "you" in the UI.
   *  The other seat renders as "Opponent's hands" regardless of whether it's
   *  the solo AI or another human in multiplayer. Defaults to "p1". */
  you?: PlayerId;
  /** Hand indices the pending card may legally land on. */
  legalHands?: number[];
  /** A card is being dragged — light legal targets, dim the rest. */
  dragging?: boolean;
  /** Hands with index < this are revealed: the opponent's card flips face-up
   *  and both sides of that matchup pick up a win/lose/tie highlight. */
  reveal?: number;
  /** The local player may draw right now — the deck becomes clickable. */
  canDraw?: boolean;
  onDraw?: () => void;
  /** Seconds left in an active turn countdown; omit for no countdown shown. */
  timerSeconds?: number;
  /** Action content shown beside the draw pile — the staged/drawn card. */
  children?: ReactNode;
};

function turnText(state: GameState, you: PlayerId): string {
  switch (state.phase) {
    case "placing":
    case "replace":
      return state.turn === you ? "Your turn" : "Opponent thinking…";
    case "reveal":
      return "Revealing…";
    case "result":
      return "Game over";
    default:
      return "";
  }
}

/** This hand's own matchup outcome, once its index has been revealed. */
function highlightFor(
  state: GameState,
  owner: PlayerId,
  revealed: number,
  handIndex: number,
): HandProps["highlight"] {
  if (handIndex >= revealed) return undefined;
  const matchup = state.result?.matchups[handIndex];
  if (!matchup) return undefined;
  if (matchup.winner === "tie") return "tie";
  return matchup.winner === owner ? "win" : "lose";
}

/**
 * The whole table: the opponent's five hands on top (compact), a centre strip
 * (draw pile, staged card, turn timer) in the middle, and your five hands
 * below. Your hands are drop targets — the legal ones light up only while a
 * card is being dragged. Your own face-down card is drawn visible to you (via
 * `Hand`'s `owner="you"` handling) — only the opponent's is ever a genuine
 * back.
 *
 * Mode-agnostic: it only knows `state` and which seat is "you" (`you`). Solo
 * and multiplayer both feed it the same way — this file has no idea an AI
 * opponent exists.
 */
export function Board({
  state,
  you = "p1",
  legalHands = [],
  dragging = false,
  reveal = 0,
  canDraw = false,
  onDraw,
  timerSeconds,
  children,
}: BoardProps) {
  const opponent = otherPlayer(you);
  const cardsLeft = 52 - state.drawCount;

  return (
    <div className={styles.board}>
      <section className={styles.row} aria-label="Opponent's hands">
        {state.hands[opponent].map((hand, i) => (
          <Hand
            key={i}
            cards={hand.cards}
            owner="opp"
            size="sm"
            reveal={i < reveal}
            highlight={highlightFor(state, opponent, reveal, i)}
          />
        ))}
      </section>

      <div className={styles.center}>
        <Deck cardsLeft={cardsLeft} canDraw={canDraw} onDraw={onDraw} />
        <div className={styles.action}>{children}</div>
        <Timer text={turnText(state, you)} secondsLeft={timerSeconds} />
      </div>

      <section className={styles.row} aria-label="Your hands">
        {state.hands[you].map((hand, i) => (
          <DropHand
            key={i}
            index={i}
            hand={hand}
            legal={legalHands.includes(i)}
            dragging={dragging}
            highlight={highlightFor(state, you, reveal, i)}
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
  highlight,
}: {
  index: number;
  hand: HandT;
  legal: boolean;
  dragging: boolean;
  highlight: HandProps["highlight"];
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
        highlight={highlight}
      />
    </div>
  );
}
