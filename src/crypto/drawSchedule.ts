import { CARDS_PER_HAND, CARDS_PER_PLAYER, HANDS_PER_PLAYER } from "../engine/constants";
import { otherPlayer } from "../engine/deck";
import type { PlayerId } from "../engine/types";

/** Deal draw index -> which player/hand it fills. Alternates for fill-evenly. */
export const DEAL_SLOTS: { player: PlayerId; hand: number }[] = Array.from(
  { length: HANDS_PER_PLAYER * 2 },
  (_, i) => ({ player: (i % 2 === 0 ? "p1" : "p2") as PlayerId, hand: Math.floor(i / 2) }),
);

// Draw indices 10..49 are the 40 per-turn placing draws; 50..51 the replace draws.
const FIRST_TURN_PLAYER: PlayerId = "p1";
const PLACING_DRAWS_END = CARDS_PER_PLAYER * 2; // 50
/** A player's own turn number (0-based) from which every placement is face-down. */
const FIRST_FACE_DOWN_TURN = (CARDS_PER_HAND - 2) * HANDS_PER_PLAYER; // 15

/** Whose placing turn consumes this draw index (turns strictly alternate). */
export function placingTurnOwner(drawIndex: number): PlayerId {
  return (drawIndex - DEAL_SLOTS.length) % 2 === 0
    ? FIRST_TURN_PLAYER
    : otherPlayer(FIRST_TURN_PLAYER);
}

/**
 * True when `drawIndex` is a placing draw that `player` must place face-down
 * (their 5th card in a hand). Derived purely from the draw index (fill-evenly
 * makes a player's own turns 15..19 the face-down ones), so it never depends
 * on a possibly stale render snapshot.
 */
export function isFaceDownDraw(drawIndex: number, player: PlayerId): boolean {
  if (drawIndex < DEAL_SLOTS.length || drawIndex >= PLACING_DRAWS_END) return false;
  if (placingTurnOwner(drawIndex) !== player) return false;
  return Math.floor((drawIndex - DEAL_SLOTS.length) / 2) >= FIRST_FACE_DOWN_TURN;
}

/** Replace-phase draws: p1's turn draws index 50, p2's draws 51. */
export function replaceDrawIndex(player: PlayerId): number {
  return PLACING_DRAWS_END + (player === FIRST_TURN_PLAYER ? 0 : 1);
}

/** Normalises a REPLACE handIndex: Firebase drops `null`, so it may be undefined on the wire. */
export function validReplaceHand(handIndex: number | null | undefined): number | null | "invalid" {
  if (handIndex === null || handIndex === undefined) return null;
  return Number.isInteger(handIndex) && handIndex >= 0 && handIndex < HANDS_PER_PLAYER ? handIndex : "invalid";
}
