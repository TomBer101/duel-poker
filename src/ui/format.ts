import type { Suit } from "../engine/types";

const RANK_LABEL: Record<number, string> = { 11: "J", 12: "Q", 13: "K", 14: "A" };

/** "A", "K", "10", "7" — the label shown on a card and in hand summaries. */
export function rankLabel(rank: number): string {
  return RANK_LABEL[rank] ?? String(rank);
}

/** Per-suit glyph and the CSS custom property holding its colour. */
export const SUIT_META: Record<Suit, { glyph: string; cssVar: string }> = {
  Spades: { glyph: "♠", cssVar: "--suit-spade" },
  Hearts: { glyph: "♥", cssVar: "--suit-heart" },
  Diamonds: { glyph: "♦", cssVar: "--suit-diamond" },
  Clubs: { glyph: "♣", cssVar: "--suit-club" },
};
