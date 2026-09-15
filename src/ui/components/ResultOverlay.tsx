import { Link } from "react-router-dom";
import { HAND_CATEGORY_NAMES } from "../../engine/constants";
import { otherPlayer } from "../../engine/deck";
import type { GameResult, PlayerId } from "../../engine/types";
import { cn } from "../cn";
import styles from "./ResultOverlay.module.css";

export type ResultOverlayProps = {
  result: GameResult;
  you: PlayerId;
  onPlayAgain: () => void;
};

type Outcome = "win" | "lose" | "tie";

function outcomeOf(winner: PlayerId | "tie" | "draw", you: PlayerId): Outcome {
  if (winner === "tie" || winner === "draw") return "tie";
  return winner === you ? "win" : "lose";
}

function titleFor(outcome: Outcome): string {
  return outcome === "tie" ? "It's a draw" : outcome === "win" ? "You win" : "You lose";
}

/**
 * The final screen: who won, the score, a hand-by-hand recap, and where to go
 * next. Rendered once `state.phase === "result"` — the reveal sequence that
 * led up to it lives in {@link RevealSequence}, inside the board itself.
 */
export function ResultOverlay({ result, you, onPlayAgain }: ResultOverlayProps) {
  const opponent = otherPlayer(you);
  const yourWins = you === "p1" ? result.wins.p1 : result.wins.p2;
  const opponentWins = opponent === "p1" ? result.wins.p1 : result.wins.p2;
  const outcome = outcomeOf(result.winner, you);

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Game result">
      <h2 className={cn(styles.title, styles[outcome])}>{titleFor(outcome)}</h2>
      <p className={styles.score}>
        {yourWins} – {opponentWins}
      </p>

      <ol className={styles.matchups}>
        {result.matchups.map((m) => {
          const yourRank = you === "p1" ? m.p1 : m.p2;
          const opponentRank = opponent === "p1" ? m.p1 : m.p2;
          return (
            <li
              key={m.handIndex}
              className={cn(styles.matchupRow, styles[outcomeOf(m.winner, you)])}
            >
              <span className={styles.matchupHand}>Hand {m.handIndex + 1}</span>
              <span>
                {HAND_CATEGORY_NAMES[yourRank.category]} vs{" "}
                {HAND_CATEGORY_NAMES[opponentRank.category]}
              </span>
            </li>
          );
        })}
      </ol>

      <div className={styles.actions}>
        <button className={styles.primary} onClick={onPlayAgain}>
          Play again
        </button>
        <Link to="/" className={styles.secondary}>
          Home
        </Link>
      </div>
    </div>
  );
}
