import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Deck } from "./Deck";

describe("Deck", () => {
  it("shows the count and stays disabled when it's not your moment to draw", () => {
    render(<Deck cardsLeft={37} />);
    const btn = screen.getByRole("button", { name: "Draw pile, 37 cards left" });
    expect(btn).toBeDisabled();
    expect(screen.queryByText("tap to draw")).toBeNull();
  });

  it("becomes a clickable button with a hint when you can draw", async () => {
    const onDraw = vi.fn();
    render(<Deck cardsLeft={12} canDraw onDraw={onDraw} />);
    const btn = screen.getByRole("button", {
      name: "Draw pile, 12 cards left — tap to draw",
    });
    expect(btn).toBeEnabled();
    btn.click();
    expect(onDraw).toHaveBeenCalledTimes(1);
    expect(screen.getByText("tap to draw")).toBeInTheDocument();
  });
});
