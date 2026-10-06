import { useEffect, useState } from "react";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import { useParams } from "react-router-dom";
import { useFirebaseClient } from "../../app/firebaseContext";
import { MAX_STRIKES, TURN_TIMEOUT_MS } from "../../engine/constants";
import { DEAL_SLOTS } from "../../crypto/drawSchedule";
import { otherPlayer } from "../../engine/deck";
import type { PlayerId } from "../../engine/types";
import { findSeat } from "../../net/room";
import { subscribeToGameNumber } from "../../net/roomState";
import { subscribeToPresence } from "../../net/sync";
import { Board } from "../components/Board";
import { Card } from "../components/Card";
import { DisconnectOverlay } from "../components/DisconnectOverlay";
import { DrawnCard } from "../components/DrawnCard";
import { ProtocolErrorScreen } from "../components/ProtocolErrorScreen";
import { ResultOverlay } from "../components/ResultOverlay";
import { RevealSequence } from "../components/RevealSequence";
import { StrikeIndicator } from "../components/StrikeIndicator";
import { useDragPlacement } from "../hooks/useDragPlacement";
import { useMultiplayerGame } from "../hooks/multiplayer/useMultiplayerGame";
import { useSessionScore } from "../hooks/multiplayer/useSessionScore";
import { useRemoteTimer } from "../hooks/useRemoteTimer";
import { useSoloGame } from "../hooks/useSoloGame";
import { useTimer } from "../hooks/useTimer";
import styles from "./GameScreen.module.css";

/** The seat the lobby stored for this tab, if any (see useLobby). */
function readStoredSeat(roomId: string): PlayerId | null {
  const v = sessionStorage.getItem(`duelPoker-you-${roomId}`);
  return v === "p1" || v === "p2" ? v : null;
}

/**
 * Route shell. A rematch is a REMOUNT: the body is keyed by the room's
 * gameNumber, so every per-game hook (refs, protocol state, seeds, engine
 * state) starts from scratch when the reset bumps it. Nothing renders until
 * the first gameNumber arrives, so a refresh mid-series never boots game 1.
 *
 * The seat comes from this tab's session (set by the lobby); a tab without one
 * (new tab, killed PWA) recovers it from the room's seats by auth uid. A uid
 * seated in neither seat gets an error, never a guessed seat.
 */
export function GameScreen() {
  const { roomId } = useParams();
  const { client, uid } = useFirebaseClient();
  const stored = roomId ? readStoredSeat(roomId) : null;
  // Tagged with its room, like `seen` below. `you: null` = not seated here.
  const [found, setFound] = useState<{ roomId: string; you: PlayerId | null } | null>(null);
  useEffect(() => {
    if (!roomId || stored || !uid) return;
    let cancelled = false;
    findSeat(client.db, roomId, uid)
      .catch((err: unknown) => {
        console.error("[GameScreen] seat lookup failed", err);
        return null;
      })
      .then((you) => {
        if (!cancelled) setFound({ roomId, you });
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, stored, uid, client.db]);
  const you = stored ?? (found && found.roomId === roomId ? found.you : undefined);

  // Tagged with its room so a number is never used for a different room.
  const [seen, setSeen] = useState<{ roomId: string; n: number } | null>(null);
  useEffect(() => {
    if (!roomId) return;
    return subscribeToGameNumber(client.db, roomId, (n) => setSeen({ roomId, n }));
  }, [roomId, client.db]);
  const gameNumber = seen && seen.roomId === roomId ? seen.n : null;

  if (!roomId) return <GameScreenBody key="solo" />;
  if (you === null) {
    return (
      <ProtocolErrorScreen
        title="No seat in this room"
        message={`This tab couldn't confirm a seat for you in room ${roomId}, so the game can't be shown here.`}
      />
    );
  }
  if (gameNumber === null || you === undefined) return null;
  return <GameScreenBody key={gameNumber} roomId={roomId} gameNumber={gameNumber} you={you} />;
}

type GameScreenBodyProps = { roomId?: string; gameNumber?: number; you?: PlayerId };

function GameScreenBody({ roomId, gameNumber = 1, you: seat = "p1" }: GameScreenBodyProps) {
  const { client } = useFirebaseClient();
  const solo = useSoloGame();
  const multiplayer = useMultiplayerGame({
    db: client.db,
    roomId: roomId ?? "",
    you: seat,
    gameNumber,
  });
  // Both hooks always run (hooks can't be called conditionally); only one
  // result is used. With an empty `roomId`, `useMultiplayerGame` opens no
  // Firebase listener: the room-level subscriptions (dealer, events, rematch,
  // presence) guard on `roomId`, and every protocol effect waits on `role`,
  // which only the dealer subscription can resolve.
  const g = roomId ? multiplayer : solo;

  const you = multiplayer.you;
  const [opponentPresent, setOpponentPresent] = useState(true);
  useEffect(() => {
    if (!roomId) return;
    return subscribeToPresence(client.db, roomId, (presence) => {
      setOpponentPresent(presence[otherPlayer(you)] === true);
    });
  }, [roomId, client.db, you]);
  const { state } = g;
  const sessionScore = useSessionScore(client.db, roomId, you, gameNumber, state);
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

  // Multiplayer only (solo has no protocol); replaces the board and every overlay.
  if (roomId && multiplayer.hasViolation) {
    return <ProtocolErrorScreen reason={multiplayer.violationReason} />;
  }

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
          <ResultOverlay
            result={state.result}
            you={g.you}
            onPlayAgain={g.playAgain}
            rematchRequested={roomId ? multiplayer.rematchRequested : false}
            sessionScore={sessionScore}
          />
        )}

        {roomId && state.phase !== "result" && (
          <DisconnectOverlay
            opponentPresent={opponentPresent}
            canClaim={state.drawCount >= DEAL_SLOTS.length}
            onClaimWin={multiplayer.claimWin}
          />
        )}

        <DragOverlay dropAnimation={null}>
          {drag.dragging && pending ? <Card card={pending} size="md" /> : null}
        </DragOverlay>
      </div>
    </DndContext>
  );
}
