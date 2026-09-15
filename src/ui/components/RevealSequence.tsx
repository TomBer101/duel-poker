import { AnimatePresence, motion } from "motion/react";
import { otherPlayer } from "../../engine/deck";
import { HAND_CATEGORY_NAMES } from "../../engine/constants";
import type { GameResult, PlayerId } from "../../engine/types";
import styles from "./RevealSequence.module.css";

export type RevealSequenceProps = {
  result: GameResult;
  /** How many matchups have been revealed so far (Board's `reveal` count). */
  revealIndex: number;
  you: PlayerId;
};

/**
 * Lives in Board's centre-strip action slot during the reveal phase: names the
 * matchup that just flipped, who won it, and a running tally — paced by
 * {@link useRevealPacer} one hand every few seconds, same beat the hands
 * themselves flip on.
 */
export function RevealSequence({ result, revealIndex, you }: RevealSequenceProps) {
  const opponent = otherPlayer(you);
  const shown = result.matchups.slice(0, revealIndex);
  const current = shown.at(-1);
  const tallyYou = shown.filter((m) => m.winner === you).length;
  const tallyOpp = shown.filter((m) => m.winner === opponent).length;

  return (
    <div className={styles.reveal}>
      <AnimatePresence mode="wait">
        {current && (
          <motion.div
            key={current.handIndex}
            className={styles.matchup}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
          >
            <p className={styles.handLabel}>Hand {current.handIndex + 1}</p>
            <p className={styles.ranks}>
              {HAND_CATEGORY_NAMES[(you === "p1" ? current.p1 : current.p2).category]}
              {" vs "}
              {HAND_CATEGORY_NAMES[(opponent === "p1" ? current.p1 : current.p2).category]}
            </p>
            <p
              className={styles.outcome}
              data-outcome={
                current.winner === "tie" ? "tie" : current.winner === you ? "win" : "lose"
              }
            >
              {current.winner === "tie"
                ? "Tie — no points"
                : current.winner === you
                  ? "You win this hand"
                  : "Opponent wins this hand"}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
      <p className={styles.tally}>
        {tallyYou} – {tallyOpp}
      </p>
    </div>
  );
}
