import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { GameResult } from "../../engine/types";
import { ResultOverlay } from "./ResultOverlay";

const result: GameResult = {
  matchups: [
    {
      handIndex: 0,
      p1: { category: 6, tiebreakers: [] }, // Flush
      p2: { category: 2, tiebreakers: [] }, // Pair
      winner: "p1",
    },
    {
      handIndex: 1,
      p1: { category: 1, tiebreakers: [] },
      p2: { category: 1, tiebreakers: [] },
      winner: "tie",
    },
  ],
  wins: { p1: 1, p2: 0 },
  winner: "p1",
};

const renderIn = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("ResultOverlay", () => {
  it("declares the winner and score from the given seat's perspective", () => {
    renderIn(<ResultOverlay result={result} you="p1" onPlayAgain={vi.fn()} />);
    expect(screen.getByText("You win")).toBeInTheDocument();
    expect(screen.getByText("1 – 0")).toBeInTheDocument();
  });

  it("flips to a loss when viewed from the other seat", () => {
    renderIn(<ResultOverlay result={result} you="p2" onPlayAgain={vi.fn()} />);
    expect(screen.getByText("You lose")).toBeInTheDocument();
    expect(screen.getByText("0 – 1")).toBeInTheDocument();
  });

  it("lists every matchup's ranks", () => {
    renderIn(<ResultOverlay result={result} you="p1" onPlayAgain={vi.fn()} />);
    expect(screen.getByText("Flush vs Pair")).toBeInTheDocument();
    expect(screen.getByText("High Card vs High Card")).toBeInTheDocument();
  });

  it("shows a disabled waiting state after the rematch vote, Home stays", () => {
    renderIn(<ResultOverlay result={result} you="p1" onPlayAgain={vi.fn()} rematchRequested />);
    expect(screen.getByRole("button", { name: "Waiting for opponent…" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Play again" })).toBeNull();
    expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
  });

  it("calls onPlayAgain and links home", () => {
    const onPlayAgain = vi.fn();
    renderIn(<ResultOverlay result={result} you="p1" onPlayAgain={onPlayAgain} />);
    screen.getByRole("button", { name: "Play again" }).click();
    expect(onPlayAgain).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
  });

  it("shows the session score only when provided (multiplayer)", () => {
    const { unmount } = renderIn(
      <ResultOverlay result={result} you="p1" onPlayAgain={vi.fn()} sessionScore={{ you: 3, opponent: 1 }} />,
    );
    expect(screen.getByText("Session: 3 – 1")).toBeInTheDocument();
    unmount();
    renderIn(<ResultOverlay result={result} you="p1" onPlayAgain={vi.fn()} />);
    expect(screen.queryByText(/Session/)).toBeNull();
  });
});
