import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { DisconnectOverlay } from "./DisconnectOverlay";

describe("DisconnectOverlay", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("renders nothing while the opponent is present", () => {
    render(<DisconnectOverlay opponentPresent canClaim onClaimWin={vi.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("shows a countdown once the opponent disconnects, then a Claim win button", () => {
    render(<DisconnectOverlay opponentPresent={false} canClaim onClaimWin={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /claim win/i })).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByRole("button", { name: /claim win/i })).toBeInTheDocument();
  });

  test("clicking Claim win calls onClaimWin", () => {
    const onClaimWin = vi.fn();
    render(<DisconnectOverlay opponentPresent={false} canClaim onClaimWin={onClaimWin} />);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    screen.getByRole("button", { name: /claim win/i }).click();
    expect(onClaimWin).toHaveBeenCalledOnce();
  });

  test("formats the countdown as m:ss", () => {
    render(<DisconnectOverlay opponentPresent={false} canClaim onClaimWin={vi.fn()} />);
    expect(screen.getByText(/1:00/)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(13_000);
    });
    expect(screen.getByText(/0:47/)).toBeInTheDocument();
  });

  test("before the deal the expired overlay offers no claim, only a waiting message", () => {
    const onClaimWin = vi.fn();
    const { rerender } = render(<DisconnectOverlay opponentPresent={false} canClaim={false} onClaimWin={onClaimWin} />);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.queryByRole("button", { name: /claim win/i })).not.toBeInTheDocument();
    expect(screen.getByText(/waiting for the game to start/i)).toBeInTheDocument();
    rerender(<DisconnectOverlay opponentPresent={false} canClaim onClaimWin={onClaimWin} />);
    expect(screen.getByRole("button", { name: /claim win/i })).toBeInTheDocument();
  });
});
