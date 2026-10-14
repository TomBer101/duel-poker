import { vi } from "vitest";
import { createInitialState, gameReducer } from "../../../engine/reducer";
import { getLegalHands, isFaceDownPlacement } from "../../../engine/placement";
import { orderedDeck } from "../../../engine/testkit";
import type { GameEvent, GameState, PlayerId } from "../../../engine/types";
import { createProtocolState } from "../../../crypto/protocolController";
import type { MultiplayerCtx } from "./context";

// Test-only helpers for the multiplayer hook modules' unit tests: engine
// states reached through the real reducer, and a stub ctx.

export const deck = orderedDeck();
export const endTurn = (by: PlayerId, handIndex: number, faceDown = false): GameEvent => ({
  type: "END_TURN",
  by,
  handIndex,
  faceDown,
});

export function dealt(): GameState {
  return gameReducer(createInitialState({ mode: "multiplayer" }), {
    type: "DEAL",
    cards: { p1: deck.slice(0, 5), p2: deck.slice(5, 10) },
  });
}

/** Plays placing turns on the lowest legal hand until `drawCount === drawIndex` (next card not drawn). */
export function before(drawIndex: number): GameState {
  let s = dealt();
  while (s.drawCount < drawIndex) {
    const by = s.turn;
    s = gameReducer(s, { type: "DRAW", by, card: deck[s.drawCount] });
    const h = getLegalHands(s.hands[by])[0];
    s = gameReducer(s, endTurn(by, h, isFaceDownPlacement(s.hands[by][h])));
  }
  return s;
}

export const drawn = (s: GameState): GameState => gameReducer(s, { type: "DRAW", by: s.turn, card: deck[s.drawCount] });

export function fakeCtx(state: GameState, you: PlayerId, role: "dealer" | "selector") {
  const ctx = {
    db: {},
    roomId: "room",
    dealerState: { current: { seed: new Uint8Array(16) } },
    protocol: { current: createProtocolState() },
    you,
    role,
    state,
    dispatch: vi.fn(),
    hasPendingDispatch: () => false,
    recordViolation: vi.fn(),
    updateProtocol: vi.fn(),
    warnOnce: vi.fn(),
    bumpTick: vi.fn(),
    refs: {
      ownSlotDraw: { current: new Map<number, number>() },
      placedForDraw: { current: null as number | null },
      replacedForDraw: { current: null as number | null },
      timedOutForDraw: { current: null as number | null },
      timedOutOwnHiddenForDraw: { current: null },
      claimedWin: { current: false },
      rematchVoted: { current: false },
      seenKeys: { current: new Set<string>() },
      lastSeq: { current: 0 },
      batchPublished: { current: false },
      resumed: { current: false },
    },
  };
  return ctx as typeof ctx & MultiplayerCtx;
}
