import { DndContext } from "@dnd-kit/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Card as CardT } from "../../engine/types";
import { DrawnCard } from "./DrawnCard";

const AH: CardT = { suit: "Hearts", rank: 14 };

const renderIn = (ui: React.ReactNode) =>
  render(<DndContext>{ui}</DndContext>);

describe("DrawnCard", () => {
  it("shows the drawn card and a drag prompt", () => {
    renderIn(<DrawnCard card={AH} />);
    expect(screen.getByRole("img")).toHaveAccessibleName("A of Hearts");
    expect(screen.getByText("drag to a hand")).toBeInTheDocument();
  });

  it("drops the drag prompt when disabled", () => {
    renderIn(<DrawnCard card={AH} disabled />);
    expect(screen.queryByText("drag to a hand")).toBeNull();
  });
});
