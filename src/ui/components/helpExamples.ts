import { HAND_CATEGORY, HAND_CATEGORY_NAMES } from "../../engine/constants";
import type { Card, HandCategory, Rank, Suit } from "../../engine/types";

const SUITS: Record<string, Suit> = { H: "Hearts", D: "Diamonds", C: "Clubs", S: "Spades" };
const FACE_RANKS: Record<string, Rank> = { J: 11, Q: 12, K: 13, A: 14 };

/** Space-separated shorthand: rank (2-10, J, Q, K, A) + suit letter, e.g. "10H KS". */
function hand(codes: string): Card[] {
  return codes.split(" ").map((code) => {
    const r = code.slice(0, -1);
    return { rank: FACE_RANKS[r] ?? (Number(r) as Rank), suit: SUITS[code.slice(-1)] };
  });
}

export type HandExample = { name: string; description: string; cards: Card[] };

const EXAMPLES: [HandCategory, string, string][] = [
  [HAND_CATEGORY.STRAIGHT_FLUSH, "Five in a row, same suit", "5H 6H 7H 8H 9H"],
  [HAND_CATEGORY.FOUR_OF_A_KIND, "Four cards of one rank", "9H 9D 9C 9S KH"],
  [HAND_CATEGORY.FULL_HOUSE, "Three of a kind plus a pair", "QH QD QC 4S 4H"],
  [HAND_CATEGORY.FLUSH, "Five cards of one suit", "2S 6S 9S JS KS"],
  [HAND_CATEGORY.STRAIGHT, "Five in a row (A can be high or low)", "4C 5D 6H 7S 8C"],
  [HAND_CATEGORY.THREE_OF_A_KIND, "Three cards of one rank", "7H 7D 7C 2S KH"],
  [HAND_CATEGORY.TWO_PAIR, "Two different pairs", "JH JD 3C 3S 9H"],
  [HAND_CATEGORY.PAIR, "Two cards of one rank", "10H 10D 2C 6S KH"],
  [HAND_CATEGORY.HIGH_CARD, "None of the above", "AH JD 8C 5S 2H"],
];

/** Strongest first. */
export const HAND_EXAMPLES: HandExample[] = EXAMPLES.map(([category, description, codes]) => ({
  name: HAND_CATEGORY_NAMES[category],
  description,
  cards: hand(codes),
}));
