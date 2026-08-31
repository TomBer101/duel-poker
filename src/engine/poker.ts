import { HAND_CATEGORY, HAND_CATEGORY_NAMES } from "./constants";
import type { Card, HandRank } from "./types";

/**
 * Evaluate a 5-card poker hand into a comparable {@link HandRank}.
 * Throws if not given exactly 5 cards.
 */
export function evaluateHand(cards: Card[]): HandRank {
  if (cards.length !== 5) {
    throw new Error(`evaluateHand expects 5 cards, got ${cards.length}`);
  }

  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const isFlush = cards.every((c) => c.suit === cards[0].suit);
  const straightHigh = straightHighCard(ranks);

  // Count occurrences of each rank.
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);

  // Groups of [rank, count], sorted by count desc, then rank desc.
  const groups = [...counts.entries()].sort((a, b) =>
    b[1] !== a[1] ? b[1] - a[1] : b[0] - a[0],
  );
  const shape = groups.map((g) => g[1]).join(""); // e.g. "32", "2111"
  const groupRanks = groups.map((g) => g[0]);

  if (isFlush && straightHigh !== null) {
    return { category: HAND_CATEGORY.STRAIGHT_FLUSH, tiebreakers: [straightHigh] };
  }
  if (shape === "41") {
    return { category: HAND_CATEGORY.FOUR_OF_A_KIND, tiebreakers: groupRanks };
  }
  if (shape === "32") {
    return { category: HAND_CATEGORY.FULL_HOUSE, tiebreakers: groupRanks };
  }
  if (isFlush) {
    return { category: HAND_CATEGORY.FLUSH, tiebreakers: ranks };
  }
  if (straightHigh !== null) {
    return { category: HAND_CATEGORY.STRAIGHT, tiebreakers: [straightHigh] };
  }
  if (shape === "311") {
    return { category: HAND_CATEGORY.THREE_OF_A_KIND, tiebreakers: groupRanks };
  }
  if (shape === "221") {
    return { category: HAND_CATEGORY.TWO_PAIR, tiebreakers: groupRanks };
  }
  if (shape === "2111") {
    return { category: HAND_CATEGORY.PAIR, tiebreakers: groupRanks };
  }
  return { category: HAND_CATEGORY.HIGH_CARD, tiebreakers: ranks };
}

/**
 * Given ranks sorted descending, return the high card of the straight, or null
 * if the five cards are not a straight. Handles the wheel (A-2-3-4-5 → high 5).
 */
function straightHighCard(ranksDesc: number[]): number | null {
  const unique = [...new Set(ranksDesc)];
  if (unique.length !== 5) return null;

  if (unique[0] - unique[4] === 4) return unique[0];

  // Wheel: A,5,4,3,2 → treat ace as low.
  if (
    unique[0] === 14 &&
    unique[1] === 5 &&
    unique[2] === 4 &&
    unique[3] === 3 &&
    unique[4] === 2
  ) {
    return 5;
  }
  return null;
}

/** Returns -1 if a < b, 1 if a > b, 0 if equal. */
export function compareHands(a: HandRank, b: HandRank): -1 | 0 | 1 {
  if (a.category !== b.category) return a.category < b.category ? -1 : 1;
  const len = Math.max(a.tiebreakers.length, b.tiebreakers.length);
  for (let i = 0; i < len; i++) {
    const av = a.tiebreakers[i] ?? 0;
    const bv = b.tiebreakers[i] ?? 0;
    if (av !== bv) return av < bv ? -1 : 1;
  }
  return 0;
}

/** Display name, distinguishing a royal flush from a lower straight flush. */
export function handRankName(rank: HandRank): string {
  if (
    rank.category === HAND_CATEGORY.STRAIGHT_FLUSH &&
    rank.tiebreakers[0] === 14
  ) {
    return "Royal Flush";
  }
  return HAND_CATEGORY_NAMES[rank.category];
}
