import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { HAND_EXAMPLES } from "./helpExamples";
import { HelpButton } from "./HelpButton";

describe("HelpButton", () => {
  test("opens on the rules slide, pages to the hand ranking, and closes", () => {
    render(<HelpButton />);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /how to play/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Game rules")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByText("Hand ranking")).toBeInTheDocument();
    expect(screen.getByText("Straight Flush")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByText("Game rules")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("HAND_EXAMPLES", () => {
  test("lists all nine hands with five cards each", () => {
    expect(HAND_EXAMPLES).toHaveLength(9);
    for (const h of HAND_EXAMPLES) expect(h.cards).toHaveLength(5);
  });
});
