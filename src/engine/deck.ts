import { RANKS, SUITS } from "./constants";
import type { Card, PlayerId } from "./types";

/** Stable string id for a card, e.g. "Hearts-14". */
export function cardId(card: Card): string {
  return `${card.suit}-${card.rank}`;
}

/** Inverse of {@link cardId} — reconstructs a Card from its wire identity. */
export function cardFromId(id: string): Card {
  const [suit, rankStr] = id.split("-") as [Card["suit"], string];
  return { suit, rank: Number(rankStr) as Card["rank"] };
}

/** A fresh, ordered 52-card deck. */
export function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

export function otherPlayer(p: PlayerId): PlayerId {
  return p === "p1" ? "p2" : "p1";
}
