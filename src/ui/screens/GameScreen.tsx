import { DndContext, DragOverlay } from "@dnd-kit/core";
import type { PlayerId } from "../../engine/types";
import { Board } from "../components/Board";
import { Card } from "../components/Card";
import { DrawnCard } from "../components/DrawnCard";
import { useDragPlacement } from "../hooks/useDragPlacement";
import { HUMAN, useSoloGame } from "../hooks/useSoloGame";
import styles from "./GameScreen.module.css";

function outcome(winner: PlayerId | "draw"): string {
  if (winner === "draw") return "It's a draw";
  return winner === HUMAN ? "You win" : "You lose";
}

export function GameScreen() {
  const g = useSoloGame();
  const { state } = g;
  const placing = state.phase === "placing";
  const pending = state.pendingCard;

  const place = (i: number) => (placing ? g.placePending(i) : g.replace(i));
  const drawCard = () => (placing ? g.draw() : g.replaceDraw());

  const drag = useDragPlacement({ legalHands: g.legalHands, onPlace: place });

  const revealCount =
    state.phase === "reveal" ? state.revealIndex : state.phase === "result" ? 5 : 0;

  return (
    <DndContext
      sensors={drag.sensors}
      onDragStart={drag.onDragStart}
      onDragEnd={drag.onDragEnd}
      onDragCancel={drag.onDragCancel}
    >
      <div className={styles.screen}>
        <Board
          state={state}
          legalHands={g.legalHands}
          dragging={drag.dragging}
          reveal={revealCount}
        >
          {g.canDraw && (
            <button className={styles.draw} onClick={drawCard}>
              {placing ? "Draw" : "Draw to swap"}
            </button>
          )}
          {g.isHumanTurn && pending && (
            <>
              <DrawnCard card={pending} />
              {!placing && (
                <button
                  className={styles.secondary}
                  onClick={() => g.replace(null)}
                >
                  Keep my hands
                </button>
              )}
            </>
          )}
        </Board>

        {drag.hint && (
          <p role="status" className={styles.hint}>
            {drag.hint}
          </p>
        )}

        {state.phase === "result" && state.result && (
          <div className={styles.result} role="dialog" aria-label="Game result">
            <h2>{outcome(state.result.winner)}</h2>
            <p>
              {state.result.wins.p1} – {state.result.wins.p2}
            </p>
            <button className={styles.draw} onClick={g.playAgain}>
              Play again
            </button>
          </div>
        )}

        <DragOverlay dropAnimation={null}>
          {drag.dragging && pending ? <Card card={pending} size="md" /> : null}
        </DragOverlay>
      </div>
    </DndContext>
  );
}
