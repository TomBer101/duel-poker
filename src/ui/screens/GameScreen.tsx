import { DndContext, DragOverlay } from "@dnd-kit/core";
import { useParams } from "react-router-dom";
import { useFirebaseClient } from "../../app/firebaseContext";
import { MAX_STRIKES, TURN_TIMEOUT_MS } from "../../engine/constants";
import { otherPlayer } from "../../engine/deck";
import { Board } from "../components/Board";
import { Card } from "../components/Card";
import { DrawnCard } from "../components/DrawnCard";
import { ResultOverlay } from "../components/ResultOverlay";
import { RevealSequence } from "../components/RevealSequence";
import { StrikeIndicator } from "../components/StrikeIndicator";
import { useDragPlacement } from "../hooks/useDragPlacement";
import { useMultiplayerGame } from "../hooks/useMultiplayerGame";
import { useRemoteTimer } from "../hooks/useRemoteTimer";
import { useSoloGame } from "../hooks/useSoloGame";
import { useTimer } from "../hooks/useTimer";
import styles from "./GameScreen.module.css";

function readYou(roomId: string): "p1" | "p2" {
  return (sessionStorage.getItem(`duelPoker-you-${roomId}`) as "p1" | "p2" | null) ?? "p1";
}

export function GameScreen() {
  const { roomId } = useParams();
  const { client } = useFirebaseClient();
  const solo = useSoloGame();
  const multiplayer = useMultiplayerGame({
    db: client.db,
    roomId: roomId ?? "",
    you: roomId ? readYou(roomId) : "p1",
    gameNumber: 1,
  });
  // Both hooks always run (hooks can't be called conditionally); only one
  // result is used. `useMultiplayerGame` no-ops its Firebase subscriptions
  // when `roomId` is empty (`role` never resolves for an empty room id, and
  // every effect guards on `role`).
  const g = roomId ? multiplayer : solo;
  const { state } = g;
  const placing = state.phase === "placing";
  const pending = state.pendingCard;

  const place = (i: number) => (placing ? g.placePending(i) : g.replace(i));
  const drawCard = () => (placing ? g.draw() : g.replaceDraw());

  const drag = useDragPlacement({ legalHands: g.legalHands, onPlace: place });

  // Solo: the countdown runs only once a card has been drawn (the engine
  // auto-places on timeout during placing only).
  const timerActive = g.isHumanTurn && placing && pending !== null;
  const localSeconds = useTimer(!roomId && timerActive, TURN_TIMEOUT_MS, g.timeout);
  // Multiplayer: ONE turn-aware timer serves both turns. `timeout()` is a
  // no-op on my own turn and reports the opponent's timeout on theirs.
  const remoteSeconds = useRemoteTimer(
    client.db,
    roomId ?? "",
    !!roomId && placing,
    TURN_TIMEOUT_MS,
    g.timeout,
    `${state.phase}:${state.turn}`,
  );
  const secondsLeft = roomId ? remoteSeconds : localSeconds;
  const showTimer = roomId ? g.isHumanTurn && placing : timerActive;

  const revealCount =
    state.phase === "reveal" ? state.revealIndex : state.phase === "result" ? 5 : 0;

  return (
    <DndContext
      sensors={drag.sensors}
      onDragStart={drag.onDragStart}
      onDragEnd={drag.onDragEnd}
      onDragCancel={drag.onDragCancel}
    >
      <div className={styles.screen} data-testid="game-screen">
        <div className={styles.strikes}>
          <StrikeIndicator strikes={state.strikes[g.you]} max={MAX_STRIKES} />
          <StrikeIndicator strikes={state.strikes[otherPlayer(g.you)]} max={MAX_STRIKES} />
        </div>
        <Board
          state={state}
          you={g.you}
          legalHands={g.legalHands}
          dragging={drag.dragging}
          reveal={revealCount}
          canDraw={g.canDraw}
          onDraw={drawCard}
          timerSeconds={showTimer ? secondsLeft : undefined}
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
