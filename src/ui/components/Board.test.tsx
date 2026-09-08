import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createInitialState } from "../../engine/reducer";
import { Board } from "./Board";

describe("Board", () => {
  it("lays out five opponent hands and five of yours", () => {
    render(<Board state={createInitialState({ mode: "solo" })} />);
    // 5 + 5 Hand columns, all empty at the start.
    const opp = screen.getByLabelText("Opponent's hands");
    const you = screen.getByLabelText("Your hands");
    expect(opp.children).toHaveLength(5);
    expect(you.children).toHaveLength(5);
  });

  it("shows the draw-pile count and whose turn it is", () => {
    render(<Board state={createInitialState({ mode: "solo", firstTurn: "p1" })} />);
    expect(screen.getByText("Your turn")).toBeInTheDocument();
    expect(screen.getByLabelText("Draw pile, 52 cards left")).toBeInTheDocument();
  });

  it("reads the AI's turn as 'Opponent thinking…'", () => {
    render(<Board state={createInitialState({ mode: "solo", firstTurn: "p2" })} />);
    expect(screen.getByText("Opponent thinking…")).toBeInTheDocument();
  });

  it("marks the legal hands passed in", () => {
    render(
      <Board
        state={createInitialState({ mode: "solo" })}
        legalHands={[0, 2, 4]}
      />,
    );
    const you = screen.getByLabelText("Your hands");
    const legal = [...you.children].map((el) => el.getAttribute("data-legal"));
    expect(legal).toEqual(["true", null, "true", null, "true"]);
  });
});
