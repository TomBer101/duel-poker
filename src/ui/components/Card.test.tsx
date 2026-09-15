import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Card as CardT } from "../../engine/types";
import { rankLabel } from "../format";
import { Card } from "./Card";

const AH: CardT = { suit: "Hearts", rank: 14 };
const TS: CardT = { suit: "Spades", rank: 10 };

describe("rankLabel", () => {
  it("names face cards and the ace, passes numbers through", () => {
    expect(rankLabel(14)).toBe("A");
    expect(rankLabel(13)).toBe("K");
    expect(rankLabel(11)).toBe("J");
    expect(rankLabel(10)).toBe("10");
    expect(rankLabel(2)).toBe("2");
  });
});

describe("Card", () => {
  it("face-up: exposes rank + suit in the accessible label and the glyph on screen", () => {
    render(<Card card={AH} />);
    expect(screen.getByRole("img")).toHaveAccessibleName("A of Hearts");
    expect(screen.getAllByText("♥").length).toBeGreaterThan(0);
    expect(screen.getAllByText("A").length).toBeGreaterThan(0);
  });

  it("unknown card (no `card` prop): renders a plain back, leaks nothing", () => {
    render(<Card />);
    expect(screen.getByRole("img")).toHaveAccessibleName("hidden card");
    expect(screen.queryByText("♠")).toBeNull();
    expect(screen.queryByText("A")).toBeNull();
  });

  it("your own hidden-from-opponent card: shown face-up to you, with a badge", () => {
    render(<Card card={TS} mine />);
    expect(screen.getByRole("img")).toHaveAccessibleName(
      "your 10 of Spades (hidden from your opponent)",
    );
    expect(screen.getByText("🔒")).toBeInTheDocument();
    // The rank is genuinely visible — this is not a back render.
    expect(screen.getAllByText("10").length).toBeGreaterThan(0);
  });

  it("still supports an explicit face-down + mine render (back with a lock)", () => {
    render(<Card card={TS} faceDown mine />);
    expect(screen.getByRole("img")).toHaveAccessibleName(
      "your 10 of Spades (hidden from your opponent)",
    );
    // Exactly one badge (the back's) — the front face isn't showing, so it
    // doesn't get one too. (Its rank text is still in the DOM, off-screen via
    // the 3D flip, same as any face-up card's back is — that's not a leak:
    // an opponent's genuinely-unknown card never receives a `card` prop at
    // all, per the "hides the opponent's..." tests.)
    expect(screen.getAllByText("🔒")).toHaveLength(1);
  });

  it("maps each suit to its own colour variable", () => {
    const { rerender } = render(<Card card={{ suit: "Diamonds", rank: 5 }} />);
    let front = document.querySelector("[style*='--suit']") as HTMLElement;
    expect(front.style.getPropertyValue("--suit")).toBe("var(--suit-diamond)");

    rerender(<Card card={{ suit: "Clubs", rank: 5 }} />);
    front = document.querySelector("[style*='--suit']") as HTMLElement;
    expect(front.style.getPropertyValue("--suit")).toBe("var(--suit-club)");
  });
});
