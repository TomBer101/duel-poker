import { DndContext } from "@dnd-kit/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createInitialState } from "../../engine/reducer";
import { Board, type BoardProps } from "./Board";

// Board's your-hands use useDroppable, which needs a DndContext ancestor.
function renderBoard(props: BoardProps) {
  return render(
    <DndContext>
      <Board {...props} />
    </DndContext>,
  );
}

const markedLegal = () =>
  screen.getByLabelText("Your hands").querySelectorAll("[data-legal]").length;

describe("Board", () => {
  it("lays out five opponent hands and five of yours", () => {
    renderBoard({ state: createInitialState({ mode: "solo" }) });
    expect(screen.getByLabelText("Opponent's hands").children).toHaveLength(5);
    expect(screen.getByLabelText("Your hands").children).toHaveLength(5);
  });

  it("shows the draw-pile count and whose turn it is", () => {
    renderBoard({ state: createInitialState({ mode: "solo", firstTurn: "p1" }) });
    expect(screen.getByText("Your turn")).toBeInTheDocument();
    expect(screen.getByLabelText("Draw pile, 52 cards left")).toBeInTheDocument();
  });

  it("reads the AI's turn as 'Opponent thinking…'", () => {
    renderBoard({ state: createInitialState({ mode: "solo", firstTurn: "p2" }) });
    expect(screen.getByText("Opponent thinking…")).toBeInTheDocument();
  });

  it("only marks legal hands while a card is being dragged", () => {
    const state = createInitialState({ mode: "solo" });

    const { rerender } = render(
      <DndContext>
        <Board state={state} legalHands={[0, 2, 4]} dragging={false} />
      </DndContext>,
    );
    expect(markedLegal()).toBe(0);

    rerender(
      <DndContext>
        <Board state={state} legalHands={[0, 2, 4]} dragging />
      </DndContext>,
    );
    expect(markedLegal()).toBe(3);
  });
});
