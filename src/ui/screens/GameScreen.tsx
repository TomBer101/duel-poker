import { DndContext, DragOverlay } from "@dnd-kit/core";
import { TURN_TIMEOUT_MS } from "../../engine/constants";
import { Board } from "../components/Board";
import { Card } from "../components/Card";
import { DrawnCard } from "../components/DrawnCard";
import { ResultOverlay } from "../components/ResultOverlay";
import { RevealSequence } from "../components/RevealSequence";
import { useDragPlacement } from "../hooks/useDragPlacement";
import { useSoloGame } from "../hooks/useSoloGame";
import { useTimer } from "../hooks/useTimer";
import styles from "./GameScreen.module.css";

export function GameScreen() {
  const g = useSoloGame();
  const { state } = g;
  const placing = state.phase === "placing";
  const pending = state.pendingCard;

  const place = (i: number) => (placing ? g.placePending(i) : g.replace(i));
  const drawCard = () => (placing ? g.draw() : g.replaceDraw());

  const drag = useDragPlacement({ legalHands: g.legalHands, onPlace: place });

  // The engine only auto-places on timeout during the placing phase (there is
  // no replace-phase equivalent yet), and only once a card has actually been
  // drawn is there anything to place — so the countdown runs only then.
  const timerActive = g.isHumanTurn && placing && pending !== null;
  const secondsLeft = useTimer(timerActive, TURN_TIMEOUT_MS, g.timeout);

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
          you={g.you}
          legalHands={g.legalHands}
          dragging={drag.dragging}
          reveal={revealCount}
          canDraw={g.canDraw}
          onDraw={drawCard}
          timerSeconds={timerActive ? secondsLeft : undefined}
        >
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
          {state.phase === "reveal" && state.result && (
            <RevealSequence result={state.result} revealIndex={state.revealIndex} you={g.you} />
          )}
        </Board>

        {drag.hint && (
          <p role="status" className={styles.hint}>
            {drag.hint}
          </p>
        )}

        {state.phase === "result" && state.result && (
          <ResultOverlay result={state.result} you={g.you} onPlayAgain={g.playAgain} />
        )}

        <DragOverlay dropAnimation={null}>
          {drag.dragging && pending ? <Card card={pending} size="md" /> : null}
        </DragOverlay>
      </div>
    </DndContext>
  );
}
