import { describe, expect, it } from "vitest";
import { createInitialState, gameReducer, replay } from "./reducer";
import type { Card, GameEvent } from "./types";
import { getLegalHands, isFaceDownPlacement } from "./placement";
import { autoPlacePlacingPhase, orderedDeck } from "./testkit";

const solo = () => createInitialState({ mode: "solo" });
const AH: Card = { suit: "Hearts", rank: 14 };

const openingDeal = (deck: Card[]): GameEvent => ({
  type: "DEAL",
  cards: { p1: deck.slice(0, 5), p2: deck.slice(5, 10) },
});

describe("DEAL", () => {
  it("gives each hand one face-up card and advances drawCount by 10", () => {
    const deck = orderedDeck();
    const s = gameReducer(solo(), openingDeal(deck));

    expect(s.phase).toBe("placing");
    expect(s.drawCount).toBe(10);
    expect(s.hands.p1.map((h) => h.cards)).toEqual(
      deck.slice(0, 5).map((c) => [{ card: c, faceUp: true }]),
    );
    expect(s.hands.p2.map((h) => h.cards)).toEqual(
      deck.slice(5, 10).map((c) => [{ card: c, faceUp: true }]),
    );
    // Fill-evenly is still satisfied: every hand has exactly one card, so
    // all five are legal for the next placement.
    expect(getLegalHands(s.hands.p1)).toEqual([0, 1, 2, 3, 4]);
  });

  it("play continues from the dealt state — DRAW/END_TURN pick up at card 11", () => {
    const deck = orderedDeck();
    let s = gameReducer(solo(), openingDeal(deck));
    s = gameReducer(s, { type: "DRAW", by: "p1", card: deck[10] });
    expect(s.pendingCard).toEqual(deck[10]);
    s = gameReducer(s, { type: "END_TURN", by: "p1", handIndex: 0, faceDown: false });
    expect(s.hands.p1[0].cards.map((pc) => pc.card)).toEqual([deck[0], deck[10]]);
    expect(s.drawCount).toBe(11);
  });

  it("rejects a DEAL that isn't the very first thing to happen", () => {
    const deck = orderedDeck();
    let s = gameReducer(solo(), { type: "DRAW", by: "p1", card: deck[0] });
    s = gameReducer(s, { type: "END_TURN", by: "p1", handIndex: 0, faceDown: false });
    expect(() => gameReducer(s, openingDeal(deck))).toThrow();
  });

  it("rejects a DEAL that doesn't give exactly one card per hand", () => {
    const deck = orderedDeck();
    expect(() =>
      gameReducer(solo(), {
        type: "DEAL",
        cards: { p1: deck.slice(0, 4), p2: deck.slice(5, 10) },
      }),
    ).toThrow();
  });
});

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

// ---------------------------------------------------------------------------
// Hidden placements + deferred scoring (multiplayer face-down cards)

import { scoreGame } from "./scoring";
import type { GameState, PlayerId } from "./types";

/** Placing phase where every face-down placement by `hiddenBy` is PLACE_HIDDEN. */
function hiddenPlacingPhase(deck: Card[], hiddenBy: PlayerId | null) {
  let s = solo();
  const events: GameEvent[] = [];
  while (s.phase === "placing") {
    const by = s.turn;
    const handIndex = getLegalHands(s.hands[by])[0];
    const faceDown = isFaceDownPlacement(s.hands[by][handIndex]);
    const evs: GameEvent[] =
      faceDown && by === hiddenBy
        ? [{ type: "PLACE_HIDDEN", by, handIndex }]
        : [
            { type: "DRAW", by, card: deck[s.drawCount] },
            { type: "END_TURN", by, handIndex, faceDown },
          ];
    for (const e of evs) s = gameReducer(s, e);
    events.push(...evs);
  }
  return { state: s, events };
}

/** Face-down cards per hand, read from a fully-known state. */
function faceDownCards(s: GameState, p: PlayerId): Card[] {
  return s.hands[p].map((h) => h.cards[4].card as Card);
}

describe("PLACE_HIDDEN", () => {
  // Fill hand 0 of p1 to 4 cards so its next placement is face-down.
  const toFaceDownTurn = () => {
    const deck = orderedDeck();
    let s = solo();
    for (let i = 0; i < 4; i++) {
      for (const by of ["p1", "p2"] as const) {
        const h = getLegalHands(s.hands[by])[0];
        s = gameReducer(s, { type: "DRAW", by, card: deck[s.drawCount] });
        s = gameReducer(s, { type: "END_TURN", by, handIndex: h, faceDown: false });
      }
    }
    // hands 0..3 of each player hold 0..? cards; advance p1 until hand 0 has 4.
    return { s, deck };
  };

  it("places a card-less face-down slot, bumps drawCount, passes the turn", () => {
    let { s } = toFaceDownTurn();
    // find a state where p1 has a legal face-down hand
    while (!getLegalHands(s.hands[s.turn]).some((i) => isFaceDownPlacement(s.hands[s.turn][i]))) {
      const by = s.turn;
      const h = getLegalHands(s.hands[by])[0];
      s = gameReducer(s, { type: "DRAW", by, card: orderedDeck()[s.drawCount] });
      s = gameReducer(s, { type: "END_TURN", by, handIndex: h, faceDown: false });
    }
    const by = s.turn;
    const h = getLegalHands(s.hands[by]).find((i) => isFaceDownPlacement(s.hands[by][i]))!;
    const before = s.drawCount;
    const next = gameReducer(s, { type: "PLACE_HIDDEN", by, handIndex: h });
    expect(next.hands[by][h].cards[4]).toEqual({ faceUp: false });
    expect(next.drawCount).toBe(before + 1);
    expect(next.pendingCard).toBeNull();
    expect(next.turn).toBe(by === "p1" ? "p2" : "p1");
  });

  it.each([
    ["a face-up placement", (s: GameState) => ({ type: "PLACE_HIDDEN", by: s.turn, handIndex: 0 }) as GameEvent],
    ["the wrong turn", (s: GameState) => ({ type: "PLACE_HIDDEN", by: s.turn === "p1" ? "p2" : "p1", handIndex: 0 }) as GameEvent],
  ])("rejects %s", (_n, mk) => {
    const s = solo();
    expect(() => gameReducer(s, mk(s))).toThrow();
  });

  it("rejects when a card is pending", () => {
    const s = gameReducer(solo(), { type: "DRAW", by: "p1", card: AH });
    expect(() => gameReducer(s, { type: "PLACE_HIDDEN", by: "p1", handIndex: 0 })).toThrow();
  });
});

describe("hidden game flow", () => {
  const deck = orderedDeck();
  const toReplace = () => hiddenPlacingPhase(deck, "p2").state;

  it("placing with hidden slots ends in replace with card-less 5th slots", () => {
    const s = toReplace();
    expect(s.phase).toBe("replace");
    expect(s.hands.p2.every((h) => h.cards[4].card === undefined)).toBe(true);
    expect(s.hands.p1.every((h) => h.cards[4].card !== undefined)).toBe(true);
  });

  it.each([
    ["without a swap", null],
    ["with a swap", 2],
  ])("REPLACE_HIDDEN %s", (_n, handIndex) => {
    let s = toReplace();
    const before = s.drawCount;
    s = gameReducer(s, { type: "REPLACE_HIDDEN", by: "p1", handIndex });
    expect(s.drawCount).toBe(before + 1);
    expect(s.replaceDone.p1).toBe(true);
    expect(s.turn).toBe("p2");
    if (handIndex !== null) expect(s.hands.p1[handIndex].cards[4]).toEqual({ faceUp: false });
  });

  it("REPLACE_HIDDEN rejects the wrong turn, a face-up target and a repeat", () => {
    const s = toReplace();
    expect(() => gameReducer(s, { type: "REPLACE_HIDDEN", by: "p2", handIndex: null })).toThrow();
    const after = gameReducer(s, { type: "REPLACE_HIDDEN", by: "p1", handIndex: null });
    expect(() => gameReducer(after, { type: "REPLACE_HIDDEN", by: "p1", handIndex: null })).toThrow();
    expect(() => gameReducer(s, { type: "REPLACE_HIDDEN", by: "p1", handIndex: 9 })).toThrow();
  });

  const toReveal = () => {
    let s = toReplace();
    s = gameReducer(s, { type: "REPLACE_HIDDEN", by: "p1", handIndex: null });
    s = gameReducer(s, { type: "REPLACE_HIDDEN", by: "p2", handIndex: null });
    return s;
  };

  it("reaches reveal with result === null", () => {
    const s = toReveal();
    expect(s.phase).toBe("reveal");
    expect(s.result).toBeNull();
  });

  it("ADVANCE_REVEAL rejects while result is null", () => {
    expect(() => gameReducer(toReveal(), { type: "ADVANCE_REVEAL" })).toThrow();
  });

  it("REVEAL_FACE_DOWN fills slots and result equals scoreGame of the known hands", () => {
    const hidden = toReveal();
    const known = hiddenPlacingPhase(deck, null).state;
    const p2Cards = faceDownCards(known, "p2");
    const s = gameReducer(hidden, {
      type: "REVEAL_FACE_DOWN",
      cards: { p1: faceDownCards(known, "p1"), p2: p2Cards },
    });
    expect(s.hands.p2.map((h) => h.cards[4].card)).toEqual(p2Cards);
    expect(s.result).toEqual(scoreGame(s.hands));
    expect(s.phase).toBe("reveal");
  });

  it("REVEAL_FACE_DOWN rejects a missing card, a wrong phase, and a repeat", () => {
    const hidden = toReveal();
    const known = hiddenPlacingPhase(deck, null).state;
    const cardsArg = { p1: faceDownCards(known, "p1"), p2: faceDownCards(known, "p2") };
    expect(() =>
      gameReducer(hidden, { type: "REVEAL_FACE_DOWN", cards: { ...cardsArg, p2: cardsArg.p2.slice(0, 4) } }),
    ).toThrow();
    expect(() => gameReducer(toReplace(), { type: "REVEAL_FACE_DOWN", cards: cardsArg })).toThrow();
    const done = gameReducer(hidden, { type: "REVEAL_FACE_DOWN", cards: cardsArg });
    expect(() => gameReducer(done, { type: "REVEAL_FACE_DOWN", cards: cardsArg })).toThrow();
  });

  it("a fully-known game still scores in applyReplace", () => {
    let s = hiddenPlacingPhase(deck, null).state;
    s = gameReducer(s, { type: "REPLACE_HIDDEN", by: "p1", handIndex: null });
    s = gameReducer(s, { type: "REPLACE_HIDDEN", by: "p2", handIndex: null });
    expect(s.result).toEqual(scoreGame(s.hands));
  });
});
