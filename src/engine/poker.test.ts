import { describe, expect, it } from "vitest";
import { compareHands, evaluateHand, handRankName } from "./poker";
import { HAND_CATEGORY as HC } from "./constants";
import { cards } from "./testkit";

const ev = (...codes: string[]) => evaluateHand(cards(...codes));

describe("evaluateHand — categories", () => {
  it("high card", () => {
    expect(ev("AH", "9D", "7C", "4S", "2H").category).toBe(HC.HIGH_CARD);
  });
  it("one pair", () => {
    expect(ev("AH", "AD", "7C", "4S", "2H").category).toBe(HC.PAIR);
  });
  it("two pair", () => {
    expect(ev("AH", "AD", "7C", "7S", "2H").category).toBe(HC.TWO_PAIR);
  });
  it("three of a kind", () => {
    expect(ev("AH", "AD", "AC", "7S", "2H").category).toBe(HC.THREE_OF_A_KIND);
  });
  it("straight", () => {
    expect(ev("5H", "6D", "7C", "8S", "9H").category).toBe(HC.STRAIGHT);
  });
  it("ace-low straight (the wheel)", () => {
    const r = ev("AH", "2D", "3C", "4S", "5H");
    expect(r.category).toBe(HC.STRAIGHT);
    expect(r.tiebreakers).toEqual([5]);
  });
  it("ace-high straight", () => {
    const r = ev("TH", "JD", "QC", "KS", "AH");
    expect(r.category).toBe(HC.STRAIGHT);
    expect(r.tiebreakers).toEqual([14]);
  });
  it("flush", () => {
    expect(ev("AH", "9H", "7H", "4H", "2H").category).toBe(HC.FLUSH);
  });
  it("full house", () => {
    expect(ev("AH", "AD", "AC", "7S", "7H").category).toBe(HC.FULL_HOUSE);
  });
  it("four of a kind", () => {
    expect(ev("AH", "AD", "AC", "AS", "7H").category).toBe(HC.FOUR_OF_A_KIND);
  });
  it("straight flush", () => {
    expect(ev("5H", "6H", "7H", "8H", "9H").category).toBe(HC.STRAIGHT_FLUSH);
  });
  it("wheel straight flush is not mistaken for a plain flush", () => {
    const r = ev("AH", "2H", "3H", "4H", "5H");
    expect(r.category).toBe(HC.STRAIGHT_FLUSH);
    expect(r.tiebreakers).toEqual([5]);
  });
  it("royal flush names correctly", () => {
    expect(handRankName(ev("TS", "JS", "QS", "KS", "AS"))).toBe("Royal Flush");
  });
  it("throws on wrong card count", () => {
    expect(() => evaluateHand(cards("AH", "KH"))).toThrow();
  });
});

describe("compareHands", () => {
  it("ranks categories", () => {
    expect(compareHands(ev("AH", "AD", "AC", "AS", "7H"), ev("AH", "AD", "AC", "7S", "7H"))).toBe(1);
  });
  it("breaks pair ties by pair rank then kickers", () => {
    expect(compareHands(ev("KH", "KD", "5C", "3S", "2H"), ev("QH", "QD", "AC", "KS", "JH"))).toBe(1);
    expect(compareHands(ev("KH", "KD", "9C", "3S", "2H"), ev("KC", "KS", "8C", "3D", "2C"))).toBe(1);
  });
  it("high-card kicker comparison", () => {
    expect(compareHands(ev("AH", "KD", "9C", "5S", "3H"), ev("AC", "KS", "9D", "5H", "2C"))).toBe(1);
  });
  it("equal hands compare 0", () => {
    expect(compareHands(ev("AH", "KD", "9C", "5S", "3H"), ev("AS", "KC", "9D", "5H", "3C"))).toBe(0);
  });
  it("ace-low straight loses to 2-6 straight", () => {
    expect(compareHands(ev("AH", "2D", "3C", "4S", "5H"), ev("2H", "3D", "4C", "5S", "6H"))).toBe(-1);
  });
  it("straight beats three of a kind despite lower cards", () => {
    expect(compareHands(ev("2H", "3D", "4C", "5S", "6H"), ev("AH", "AD", "AC", "7S", "2C"))).toBe(1);
  });
});
