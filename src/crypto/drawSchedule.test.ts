import { describe, expect, test } from "vitest";
import { DEAL_SLOTS, isFaceDownDraw, placingTurnOwner, replaceDrawIndex, validReplaceHand } from "./drawSchedule";
import type { PlayerId } from "../engine/types";

const ALL_DRAWS = Array.from({ length: 52 }, (_, i) => i);

describe("isFaceDownDraw", () => {
  test.each<[PlayerId, number[]]>([
    ["p1", [40, 42, 44, 46, 48]],
    ["p2", [41, 43, 45, 47, 49]],
  ])("%s places face-down exactly at %j", (player, expected) => {
    expect(ALL_DRAWS.filter((i) => isFaceDownDraw(i, player))).toEqual(expected);
  });

  test("no draw outside 10..49 is ever face-down", () => {
    for (const i of ALL_DRAWS.filter((d) => d < 10 || d > 49)) {
      expect(isFaceDownDraw(i, "p1")).toBe(false);
      expect(isFaceDownDraw(i, "p2")).toBe(false);
    }
  });
});

describe("placingTurnOwner", () => {
  test("alternates starting with p1 over the placing draws 10..49", () => {
    for (let i = 10; i < 50; i++) {
      expect(placingTurnOwner(i)).toBe((i - 10) % 2 === 0 ? "p1" : "p2");
    }
  });
});

describe("replaceDrawIndex", () => {
  test.each<[PlayerId, number]>([
    ["p1", 50],
    ["p2", 51],
  ])("%s replaces with draw %i", (player, expected) => {
    expect(replaceDrawIndex(player)).toBe(expected);
  });
});

describe("DEAL_SLOTS", () => {
  test("maps draws 0..9 alternately to p1/p2, hand = floor(i/2)", () => {
    expect(DEAL_SLOTS).toEqual([
      { player: "p1", hand: 0 },
      { player: "p2", hand: 0 },
      { player: "p1", hand: 1 },
      { player: "p2", hand: 1 },
      { player: "p1", hand: 2 },
      { player: "p2", hand: 2 },
      { player: "p1", hand: 3 },
      { player: "p2", hand: 3 },
      { player: "p1", hand: 4 },
      { player: "p2", hand: 4 },
    ]);
  });
});

describe("validReplaceHand", () => {
  test.each<[number | null | undefined, number | null | "invalid"]>([
    [null, null],
    [undefined, null],
    [0, 0],
    [4, 4],
    [-1, "invalid"],
    [5, "invalid"],
    [1.5, "invalid"],
    [Number.NaN, "invalid"],
  ])("validReplaceHand(%s) -> %s", (input, expected) => {
    expect(validReplaceHand(input)).toBe(expected);
  });
});
