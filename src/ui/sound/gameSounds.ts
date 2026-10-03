import { HANDS_PER_PLAYER } from "../../engine/constants";
import type { GameEvent, GameResult, PlayerId } from "../../engine/types";
import { sfx } from "./useSfx";

/** Gap between each thunk of the opening deal. */
const DEAL_STAGGER_MS = 90;

/** 10 staggered `card-place` thunks — one per dealt card, dealer-style. */
function playDealSfx(): void {
  const count = HANDS_PER_PLAYER * 2;
  for (let i = 0; i < count; i++) {
    setTimeout(() => sfx.play("card-place"), i * DEAL_STAGGER_MS);
  }
}

/**
 * Play the sound effect that belongs to a game event — whoever caused it, in
 * whichever mode. Called from the engine's `dispatch`, so the opponent's synced
 * events sound exactly like your own.
 */
export function playEventSfx(event: GameEvent): void {
  switch (event.type) {
    case "DEAL":
      playDealSfx();
      break;
    case "DRAW":
    case "REPLACE_DRAW":
      sfx.play("card-draw");
      break;
    case "END_TURN":
    case "PLACE_HIDDEN":
    case "REPLACE":
    case "REPLACE_HIDDEN":
      sfx.play("card-place");
      break;
    case "REVEAL_FACE_DOWN":
    case "ADVANCE_REVEAL":
      sfx.play("card-flip");
      break;
    case "TIMEOUT":
    case "TIMEOUT_HIDDEN":
      sfx.play("time-up");
      break;
    case "REMATCH":
    case "FORFEIT":
      break;
  }
}

/** One-shot sting once the result is in, from `you`'s point of view. */
export function playResultSting(result: GameResult, you: PlayerId): void {
  const w = result.winner;
  sfx.play(w === "draw" ? "draw-game" : w === you ? "win" : "lose");
}
