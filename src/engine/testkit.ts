import { makeDeck } from "./deck";
import { isFaceDownPlacement, getLegalHands } from "./placement";
import { gameReducer } from "./reducer";
import type { Card, GameEvent, GameState, Rank, Suit } from "./types";

const RANK_CHARS: Record<string, Rank> = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
  T: 10, J: 11, Q: 12, K: 13, A: 14,
};
const SUIT_CHARS: Record<string, Suit> = {
  H: "Hearts", D: "Diamonds", C: "Clubs", S: "Spades",
};

/** Parse a card like "AH", "TS", "9D". */
export function card(code: string): Card {
  const rank = RANK_CHARS[code.slice(0, -1).toUpperCase()];
  const suit = SUIT_CHARS[code.slice(-1).toUpperCase()];
  if (rank === undefined || suit === undefined) {
    throw new Error(`bad card code: ${code}`);
  }
  return { suit, rank };
}

export function cards(...codes: string[]): Card[] {
  return codes.map(card);
}

const key = (c: Card) => `${c.suit}-${c.rank}`;

/**
 * A 52-card deck whose first cards are the given ones in order, followed by the
 * rest of a standard deck. `state.drawCount` doubles as the cursor into it.
 */
export function orderedDeck(lead: Card[] = []): Card[] {
  const used = new Set(lead.map(key));
  return [...lead, ...makeDeck().filter((c) => !used.has(key(c)))];
}

/**
 * Play the whole placing phase: on each turn draw the next deck card and place
 * it on the lowest-index legal hand. Returns the events emitted and the state
 * once the phase completes (phase === "replace").
 */
export function autoPlacePlacingPhase(
  start: GameState,
  deck: Card[],
): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  let s = start;
  let guard = 0;
  while (s.phase === "placing") {
    if (guard++ > 200) throw new Error("autoPlacePlacingPhase did not terminate");
    const by = s.turn;
    const handIndex = getLegalHands(s.hands[by])[0];
    const faceDown = isFaceDownPlacement(s.hands[by][handIndex]);
    const draw: GameEvent = { type: "DRAW", by, card: deck[s.drawCount] };
    const end: GameEvent = { type: "END_TURN", by, handIndex, faceDown };
    s = gameReducer(gameReducer(s, draw), end);
    events.push(draw, end);
  }
  return { state: s, events };
}
