import type { Card } from "../engine/types";

/**
 * Heuristic "how much does this card help?" score for a partial poker hand.
 *
 * V1 is a deliberately simple heuristic — no lookahead, no probability model.
 * It rewards the concrete ways `newCard` can improve `currentCards`:
 *
 * - **Pairing:** matching the rank of cards already in the hand (pair / trips /
 *   quads). This is weighted heavily so the AI prefers a hand it can actually
 *   pair over an empty hand.
 * - **Flush potential:** cards already sharing `newCard`'s suit, weighted
 *   super-linearly so a 4-to-a-flush hand is clearly attractive.
 * - **Straight potential:** the longest run of distinct ranks in any 5-wide
 *   window containing `newCard`. Ace-low straights are ignored in V1.
 * - **High card:** a small preference for higher ranks to break ties.
 *
 * The absolute value is meaningless; only comparisons between candidate hands
 * for the *same* card matter. Higher is better.
 */
export function projectHandStrength(currentCards: Card[], newCard: Card): number {
  const all = [...currentCards, newCard];
  let score = 0;

  // --- Pairing --------------------------------------------------------------
  const sameRank = currentCards.filter((c) => c.rank === newCard.rank).length;
  if (sameRank === 1) score += 100 + newCard.rank; // makes a pair
  else if (sameRank === 2) score += 300 + newCard.rank; // makes trips
  else if (sameRank >= 3) score += 800 + newCard.rank; // makes quads

  // --- Flush potential -----------------------------------------------------
  const sameSuit = currentCards.filter((c) => c.suit === newCard.suit).length;
  score += sameSuit * sameSuit * 3; // 0, 3, 12, 27, 48

  // --- Straight potential ------------------------------------------------
  const distinct = new Set<number>(all.map((c) => c.rank));
  let bestRun = 0;
  for (let lo = newCard.rank - 4; lo <= newCard.rank; lo++) {
    let run = 0;
    for (let r = lo; r < lo + 5; r++) {
      if (distinct.has(r)) run++;
    }
    if (run > bestRun) bestRun = run;
  }
  score += bestRun * bestRun; // up to 25

  // --- High-card tie-break ---------------------------------------------
  score += newCard.rank * 0.1;

  return score;
}
