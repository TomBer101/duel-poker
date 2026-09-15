import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PlacedCard } from "../../engine/types";
import { card } from "../../engine/testkit";
import { Hand } from "./Hand";

const up = (c: string): PlacedCard => ({ card: card(c), faceUp: true });
const down = (c: string): PlacedCard => ({ card: card(c), faceUp: false });

describe("Hand", () => {
  it("renders each placed card in order", () => {
    render(<Hand cards={[up("AH"), up("KH"), up("QH")]} owner="you" />);
    const cards = screen.getAllByRole("img");
    expect(cards.map((c) => c.getAttribute("aria-label"))).toEqual([
      "A of Hearts",
      "K of Hearts",
      "Q of Hearts",
    ]);
  });

  it("hides the opponent's face-down card completely", () => {
    render(<Hand cards={[up("AH"), down("2C")]} owner="opp" />);
    expect(screen.getByLabelText("hidden card")).toBeInTheDocument();
    expect(screen.queryByText("2")).toBeNull();
    expect(screen.queryByText("♣")).toBeNull();
  });

  it("shows your own face-down card face-up to you, badged as hidden from the opponent", () => {
    render(<Hand cards={[down("2C")]} owner="you" />);
    expect(
      screen.getByLabelText("your 2 of Clubs (hidden from your opponent)"),
    ).toBeInTheDocument();
    expect(screen.getByText("🔒")).toBeInTheDocument();
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
  });

  it("reveals the opponent's face-down card once the reveal phase reaches it", () => {
    render(<Hand cards={[down("2C")]} owner="opp" reveal />);
    expect(screen.getByLabelText("2 of Clubs")).toBeInTheDocument();
  });

  it("flags a legal drop target", () => {
    const { rerender, container } = render(<Hand cards={[]} owner="you" />);
    expect(container.firstChild).not.toHaveAttribute("data-legal");
    rerender(<Hand cards={[]} owner="you" legal />);
    expect(container.firstChild).toHaveAttribute("data-legal", "true");
  });
});
