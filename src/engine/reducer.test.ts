import { describe, expect, it } from "vitest";
import { createInitialState, gameReducer, replay } from "./reducer";
import type { Card, GameEvent } from "./types";
import { getLegalHands } from "./placement";
import { autoPlacePlacingPhase, orderedDeck } from "./testkit";

const solo = () => createInitialState({ mode: "solo" });
const AH: Card = { suit: "Hearts", rank: 14 };

describe("createInitialState", () => {
  it("starts in the placing phase with empty hands", () => {
    const s = solo();
    expect(s.phase).toBe("placing");
    expect(s.turn).toBe("p1");
    expect(s.drawCount).toBe(0);
    expect(s.hands.p1.every((h) => h.cards.length === 0)).toBe(true);
  });
});

describe("placing turn flow", () => {
  it("DRAW then END_TURN places the card and passes the turn", () => {
    let s = solo();
    s = gameReducer(s, { type: "DRAW", by: "p1", card: AH });
    expect(s.pendingCard).toEqual(AH);
    s = gameReducer(s, { type: "END_TURN", by: "p1", handIndex: 2, faceDown: false });
    expect(s.hands.p1[2].cards[0]).toEqual({ card: AH, faceUp: true });
    expect(s.pendingCard).toBeNull();
    expect(s.turn).toBe("p2");
    expect(s.drawCount).toBe(1);
  });

  it("rejects drawing out of turn and drawing twice", () => {
    let s = solo();
    expect(() => gameReducer(s, { type: "DRAW", by: "p2", card: AH })).toThrow();
    s = gameReducer(s, { type: "DRAW", by: "p1", card: AH });
    expect(() => gameReducer(s, { type: "DRAW", by: "p1", card: AH })).toThrow();
  });

  it("rejects END_TURN on an illegal hand and with a wrong faceDown flag", () => {
    const deck = orderedDeck();
    let s = solo();
    s = gameReducer(s, { type: "DRAW", by: "p1", card: deck[0] });
    expect(() =>
      gameReducer(s, { type: "END_TURN", by: "p1", handIndex: 0, faceDown: true }),
    ).toThrow();
    s = gameReducer(s, { type: "END_TURN", by: "p1", handIndex: 0, faceDown: false });
    s = gameReducer(s, { type: "DRAW", by: "p2", card: deck[1] });
    s = gameReducer(s, { type: "END_TURN", by: "p2", handIndex: 0, faceDown: false });
    // p1 again: hand 0 has a card, the rest are empty -> hand 0 is now illegal
    s = gameReducer(s, { type: "DRAW", by: "p1", card: deck[2] });
    expect(() =>
      gameReducer(s, { type: "END_TURN", by: "p1", handIndex: 0, faceDown: false }),
    ).toThrow();
  });

  it("forces every 5th card in a hand to be face-down", () => {
    const { state } = autoPlacePlacingPhase(solo(), orderedDeck());
    for (const p of ["p1", "p2"] as const) {
      for (const h of state.hands[p]) {
        expect(h.cards.slice(0, 4).every((c) => c.faceUp)).toBe(true);
        expect(h.cards[4].faceUp).toBe(false);
      }
    }
  });
});

describe("timeout and strikes", () => {
  it("auto-places on the lowest legal hand and adds a strike", () => {
    let s = solo();
    s = gameReducer(s, { type: "TIMEOUT", by: "p1", card: AH });
    expect(s.hands.p1[0].cards).toHaveLength(1);
    expect(s.strikes.p1).toBe(1);
    expect(s.turn).toBe("p2");
    expect(s.drawCount).toBe(1);
  });

  it("three strikes forfeits the game", () => {
    const deck = orderedDeck();
    let s = solo();
    for (let i = 0; i < 3 && s.phase === "placing"; i++) {
      s = gameReducer(s, { type: "TIMEOUT", by: "p1", card: deck[s.drawCount] });
      if (s.phase !== "placing") break;
      s = gameReducer(s, { type: "DRAW", by: "p2", card: deck[s.drawCount] });
      const h = getLegalHands(s.hands.p2)[0];
      s = gameReducer(s, { type: "END_TURN", by: "p2", handIndex: h, faceDown: false });
    }
    expect(s.phase).toBe("result");
    expect(s.forfeitedBy).toBe("p1");
    expect(s.result?.winner).toBe("p2");
  });
});

describe("full game playthrough", () => {
  it("runs placing -> replace -> reveal -> result and is replay-deterministic", () => {
    const deck = orderedDeck();
    const initial = createInitialState({ mode: "solo" });
    const { state: afterPlacing, events: placingEvents } = autoPlacePlacingPhase(initial, deck);
    expect(afterPlacing.phase).toBe("replace");

    const rest: GameEvent[] = [
      { type: "REPLACE_DRAW", by: "p1", card: deck[afterPlacing.drawCount] },
      { type: "REPLACE", by: "p1", handIndex: null },
      { type: "REPLACE_DRAW", by: "p2", card: deck[afterPlacing.drawCount + 1] },
      { type: "REPLACE", by: "p2", handIndex: 0 },
      { type: "ADVANCE_REVEAL" },
      { type: "ADVANCE_REVEAL" },
      { type: "ADVANCE_REVEAL" },
      { type: "ADVANCE_REVEAL" },
      { type: "ADVANCE_REVEAL" },
    ];

    const all = [...placingEvents, ...rest];
    const final = replay(initial, all);
    expect(final.phase).toBe("result");
    expect(final.revealIndex).toBe(5);
    expect(final.result?.matchups).toHaveLength(5);
    expect(["p1", "p2", "draw"]).toContain(final.result?.winner);

    const again = replay(createInitialState({ mode: "solo" }), all);
    expect(again).toEqual(final);
  });

  it("rejects a replace before drawing and an out-of-range hand", () => {
    const deck = orderedDeck();
    const { state } = autoPlacePlacingPhase(solo(), deck);
    expect(() => gameReducer(state, { type: "REPLACE", by: "p1", handIndex: 0 })).toThrow();
    const drew = gameReducer(state, { type: "REPLACE_DRAW", by: "p1", card: deck[state.drawCount] });
    expect(() => gameReducer(drew, { type: "REPLACE", by: "p1", handIndex: 9 })).toThrow();
  });
});
