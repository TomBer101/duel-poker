import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { GameResult } from "../../engine/types";
import { RevealSequence } from "./RevealSequence";

const result: GameResult = {
  matchups: [
    {
      handIndex: 0,
      p1: { category: 2, tiebreakers: [10] }, // Pair
      p2: { category: 1, tiebreakers: [9] }, // High Card
      winner: "p1",
    },
    {
      handIndex: 1,
      p1: { category: 3, tiebreakers: [] }, // Two Pair
      p2: { category: 3, tiebreakers: [] },
      winner: "tie",
    },
    {
      handIndex: 2,
      p1: { category: 1, tiebreakers: [] }, // High Card
      p2: { category: 4, tiebreakers: [] }, // Three of a Kind
      winner: "p2",
    },
  ],
  wins: { p1: 1, p2: 1 },
  winner: "draw",
};

describe("RevealSequence", () => {
  it("shows nothing revealed yet before the first hand flips", () => {
    render(<RevealSequence result={result} revealIndex={0} you="p1" />);
    expect(screen.queryByText(/Hand \d/)).toBeNull();
    expect(screen.getByText("0 – 0")).toBeInTheDocument();
  });

  it("names the just-revealed matchup, who won it, and the tally", () => {
    render(<RevealSequence result={result} revealIndex={1} you="p1" />);
    expect(screen.getByText("Hand 1")).toBeInTheDocument();
    expect(screen.getByText("Pair vs High Card")).toBeInTheDocument();
    expect(screen.getByText("You win this hand")).toBeInTheDocument();
    expect(screen.getByText("1 – 0")).toBeInTheDocument();
  });

  it("reports a tie without moving the tally", () => {
    render(<RevealSequence result={result} revealIndex={2} you="p1" />);
    expect(screen.getByText("Hand 2")).toBeInTheDocument();
    expect(screen.getByText("Tie — no points")).toBeInTheDocument();
    expect(screen.getByText("1 – 0")).toBeInTheDocument();
  });

  it("names the opponent as winner from your perspective", () => {
    render(<RevealSequence result={result} revealIndex={3} you="p1" />);
    expect(screen.getByText("Hand 3")).toBeInTheDocument();
    expect(screen.getByText("High Card vs Three of a Kind")).toBeInTheDocument();
    expect(screen.getByText("Opponent wins this hand")).toBeInTheDocument();
    expect(screen.getByText("1 – 1")).toBeInTheDocument();
  });

  it("mirrors ranks and tally when viewed from the other seat", () => {
    render(<RevealSequence result={result} revealIndex={1} you="p2" />);
    expect(screen.getByText("High Card vs Pair")).toBeInTheDocument();
    expect(screen.getByText("Opponent wins this hand")).toBeInTheDocument();
    expect(screen.getByText("0 – 1")).toBeInTheDocument();
  });
});
