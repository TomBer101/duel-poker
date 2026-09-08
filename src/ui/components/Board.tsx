import type { GameState } from "../../engine/types";
import { AI, HUMAN } from "../hooks/useSoloGame";
import { Hand } from "./Hand";
import styles from "./Board.module.css";

export type BoardProps = {
  state: GameState;
  /** Legal hand indices for the human's next placement (empty when off-turn). */
  legalHands?: number[];
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
 * with the draw pile and turn text, and your five hands below. Presentational —
 * it renders `GameState` and takes no actions; drag/drop and the action bar
 * wrap it from outside.
 */
export function Board({ state, legalHands = [] }: BoardProps) {
  const cardsLeft = 52 - state.drawCount;

  return (
    <div className={styles.board}>
      <section className={styles.row} aria-label="Opponent's hands">
        {state.hands[AI].map((hand, i) => (
          <Hand key={i} cards={hand.cards} owner="opp" size="sm" />
        ))}
      </section>

      <div className={styles.center}>
        <div className={styles.deck} aria-label={`Draw pile, ${cardsLeft} cards left`}>
          {cardsLeft}
        </div>
        <p className={styles.turn}>{turnText(state)}</p>
      </div>

      <section className={styles.row} aria-label="Your hands">
        {state.hands[HUMAN].map((hand, i) => (
          <Hand
            key={i}
            cards={hand.cards}
            owner="you"
            legal={legalHands.includes(i)}
          />
        ))}
      </section>
    </div>
  );
}
