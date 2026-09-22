import { describe, expect, it } from "vitest";
import { cardFromId, cardId, makeDeck, otherPlayer } from "./deck";

describe("cardId / cardFromId", () => {
  it("round-trips every card in a fresh deck through cardId -> cardFromId", () => {
    for (const original of makeDeck()) {
      expect(cardFromId(cardId(original))).toEqual(original);
    }
  });
});

describe("otherPlayer", () => {
  it("flips p1 <-> p2", () => {
    expect(otherPlayer("p1")).toBe("p2");
    expect(otherPlayer("p2")).toBe("p1");
  });
});
