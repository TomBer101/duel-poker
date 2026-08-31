import { describe, expect, it } from "vitest";
import { chooseHandIndex, chooseReplacement, createAiOpponent } from "./opponent";
import { createInitialState } from "../engine/reducer";
import { card, cards } from "../engine/testkit";
import type { Card, GameState, Hand, PlacedCard } from "../engine/types";

const up = (c: Card): PlacedCard => ({ card: c, faceUp: true });
const down = (c: Card): PlacedCard => ({ card: c, faceUp: false });

function handOf(cs: Card[], faceDownLast = false): Hand {
  return {
    cards: cs.map((c, i) =>
      faceDownLast && i === cs.length - 1 ? down(c) : up(c),
    ),
  };
}

function stateWithHands(p2Hands: Hand[]): GameState {
  const s = createInitialState({ mode: "solo", firstTurn: "p2" });
  return { ...s, hands: { ...s.hands, p2: p2Hands } };
}

describe("chooseHandIndex", () => {
  it("always returns a legal hand index", () => {
    const s = stateWithHands([
      handOf(cards("2H", "3D")),
      handOf(cards("4S")),
      handOf(cards("5C")),
      handOf(cards("6H")),
      handOf(cards("7D")),
    ]);
    // legal hands are those with the fewest cards: 1..4
    const idx = chooseHandIndex(s, "p2", card("9S"));
    expect([1, 2, 3, 4]).toContain(idx);
  });

  it("places a card on the hand it pairs, not an empty hand", () => {
    // every hand holds one card, so all five are legal targets
    const s = stateWithHands([
      handOf(cards("KH")), // pairing target for KS
      handOf(cards("2D")),
      handOf(cards("3C")),
      handOf(cards("4S")),
      handOf(cards("5H")),
    ]);
    expect(chooseHandIndex(s, "p2", card("KS"))).toBe(0);
  });

  it("is deterministic and picks the lowest index on a tie", () => {
    const s = stateWithHands([
      handOf([]),
      handOf([]),
      handOf([]),
      handOf([]),
      handOf([]),
    ]);
    expect(chooseHandIndex(s, "p2", card("9S"))).toBe(0);
  });

  it("throws when every hand is full", () => {
    const full = handOf(cards("2H", "3D", "4S", "5C", "6H"));
    const s = stateWithHands([full, full, full, full, full]);
    expect(() => chooseHandIndex(s, "p2", card("9S"))).toThrow();
  });
});

describe("chooseReplacement", () => {
  // Pair of 8s/9s with an ace as the face-down 5th card: swapping in a K or a
  // low card only ever makes these hands weaker, so the AI should leave them.
  const otherFour = [
    handOf(cards("8H", "8D", "4S", "5C", "AH"), true),
    handOf(cards("8C", "8S", "4D", "5S", "AD"), true),
    handOf(cards("9H", "9D", "4H", "6D", "AS"), true),
    handOf(cards("9C", "9S", "4C", "6H", "AC"), true),
  ];

  it("swaps when the drawn card strictly improves a hand", () => {
    // hand 4: K-K-7-3-[2] (pair of kings). Drawing a third K makes trips.
    const target = handOf(cards("KH", "KD", "7S", "3C", "2H"), true);
    const s = stateWithHands([...otherFour, target]);
    expect(chooseReplacement(s, "p2", card("KS"))).toEqual({ handIndex: 4 });
  });

  it("keeps all hands when the drawn card helps nothing", () => {
    const target = handOf(cards("KH", "KD", "7S", "3C", "9H"), true);
    const s = stateWithHands([...otherFour, target]);
    // 2C: pairs nothing useful, worse than the existing pair of kings hand.
    expect(chooseReplacement(s, "p2", card("2C"))).toEqual({ handIndex: null });
  });

  it("does not touch a face-up 5th card", () => {
    const target = handOf(cards("KH", "KD", "7S", "3C", "2H")); // all face up
    const s = stateWithHands([...otherFour, target]);
    expect(chooseReplacement(s, "p2", card("KS"))).toEqual({ handIndex: null });
  });
});

describe("createAiOpponent", () => {
  it("binds a seat and delegates to the pure functions", () => {
    const ai = createAiOpponent("p2");
    const s = stateWithHands([
      handOf(cards("KH")),
      handOf(cards("2D")),
      handOf(cards("3C")),
      handOf(cards("4S")),
      handOf(cards("5H")),
    ]);
    expect(ai.player).toBe("p2");
    expect(ai.chooseHandIndex(s, card("KS"))).toBe(0);
  });
});
