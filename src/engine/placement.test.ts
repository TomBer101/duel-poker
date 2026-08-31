import { describe, expect, it } from "vitest";
import { getAutoPlaceIndex, getLegalHands, isFaceDownPlacement } from "./placement";
import type { Hand, PlacedCard } from "./types";
import { card } from "./testkit";

const fu = (code: string): PlacedCard => ({ card: card(code), faceUp: true });

function hands(lengths: number[]): Hand[] {
  return lengths.map((n) => ({
    cards: Array.from({ length: n }, () => fu("2H")),
  }));
}

describe("getLegalHands", () => {
  it("all empty hands are legal", () => {
    expect(getLegalHands(hands([0, 0, 0, 0, 0]))).toEqual([0, 1, 2, 3, 4]);
  });
  it("only the least-filled hands are legal", () => {
    expect(getLegalHands(hands([1, 0, 2, 0, 1]))).toEqual([1, 3]);
  });
  it("no hands legal once all are full", () => {
    expect(getLegalHands(hands([5, 5, 5, 5, 5]))).toEqual([]);
  });
  it("5th-card round: only the hands with 4 are legal", () => {
    expect(getLegalHands(hands([4, 5, 4, 5, 5]))).toEqual([0, 2]);
  });
});

describe("getAutoPlaceIndex", () => {
  it("returns the lowest legal index", () => {
    expect(getAutoPlaceIndex(hands([2, 1, 1, 2, 2]))).toBe(1);
  });
  it("throws when nothing is placeable", () => {
    expect(() => getAutoPlaceIndex(hands([5, 5, 5, 5, 5]))).toThrow();
  });
});

describe("isFaceDownPlacement", () => {
  it("true only when the hand already has 4 cards", () => {
    expect(isFaceDownPlacement(hands([4])[0])).toBe(true);
    expect(isFaceDownPlacement(hands([3])[0])).toBe(false);
    expect(isFaceDownPlacement(hands([0])[0])).toBe(false);
  });
});
