import { describe, expect, it } from "vitest";
import { scoreGame } from "./scoring";
import type { Hand } from "./types";
import { cards } from "./testkit";

const hand = (...codes: string[]): Hand => ({
  cards: cards(...codes).map((c) => ({ card: c, faceUp: true as const })),
});

describe("scoreGame", () => {
  it("counts matchup wins and picks the game winner", () => {
    const p1 = [
      hand("AH", "AD", "AC", "AS", "KH"), // quads  -> p1
      hand("2H", "3H", "4H", "5H", "6H"), // st.flush -> p1
      hand("2C", "3D", "4S", "5H", "7C"), // high card -> p2
      hand("KH", "KD", "2C", "3S", "4H"), // pair K -> tie logic below
      hand("9H", "9D", "2C", "3S", "4H"), // pair 9 -> p2
    ];
    const p2 = [
      hand("KC", "KS", "KD", "QH", "QS"), // full house
      hand("AC", "AS", "AD", "QH", "QS"), // full house
      hand("8C", "9D", "TS", "JH", "2C"), // high card J
      hand("KC", "KS", "5C", "6S", "7H"), // pair K, better kickers
      hand("TH", "TD", "2S", "3C", "4D"), // pair 10
    ];
    const r = scoreGame({ p1, p2 });
    expect(r.matchups.map((m) => m.winner)).toEqual(["p1", "p1", "p2", "p2", "p2"]);
    expect(r.wins).toEqual({ p1: 2, p2: 3 });
    expect(r.winner).toBe("p2");
  });

  it("ties award no points and can produce a draw", () => {
    const mk = () => [
      hand("AH", "KD", "9C", "5S", "3H"),
      hand("AS", "KC", "9D", "5H", "3C"),
      hand("2H", "2D", "7C", "8S", "9H"),
      hand("QH", "JD", "TC", "4S", "3H"),
      hand("7H", "7D", "2C", "3S", "4H"),
    ];
    const r = scoreGame({ p1: mk(), p2: mk() });
    expect(r.matchups.every((m) => m.winner === "tie")).toBe(true);
    expect(r.wins).toEqual({ p1: 0, p2: 0 });
    expect(r.winner).toBe("draw");
  });

  it("throws if a face-down card was never revealed", () => {
    const good = hand("AH", "KD", "9C", "5S", "3H");
    const bad: Hand = { cards: [...good.cards.slice(0, 4), { faceUp: false }] };
    expect(() => scoreGame({ p1: [bad, good, good, good, good], p2: [good, good, good, good, good] })).toThrow();
  });
});
