import type { HandCategory, Rank, Suit } from "./types";

export const SUITS: readonly Suit[] = ["Hearts", "Diamonds", "Clubs", "Spades"];

export const RANKS: readonly Rank[] = [
  2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
];

export const HANDS_PER_PLAYER = 5;
export const CARDS_PER_HAND = 5;
export const CARDS_PER_PLAYER = HANDS_PER_PLAYER * CARDS_PER_HAND; // 25
export const DECK_SIZE = 52;

export const TURN_TIMEOUT_MS = 90_000;
export const MAX_STRIKES = 3;

/**
 * Poker hand categories, low to high. A plain `const` object rather than a TS
 * `enum` — see notes in the code review. Values match the `HandCategory` type.
 */
export const HAND_CATEGORY = {
  HIGH_CARD: 1,
  PAIR: 2,
  TWO_PAIR: 3,
  THREE_OF_A_KIND: 4,
  STRAIGHT: 5,
  FLUSH: 6,
  FULL_HOUSE: 7,
  FOUR_OF_A_KIND: 8,
  STRAIGHT_FLUSH: 9,
} as const satisfies Record<string, HandCategory>;

export const HAND_CATEGORY_NAMES: Record<HandCategory, string> = {
  1: "High Card",
  2: "Pair",
  3: "Two Pair",
  4: "Three of a Kind",
  5: "Straight",
  6: "Flush",
  7: "Full House",
  8: "Four of a Kind",
  9: "Straight Flush",
};
