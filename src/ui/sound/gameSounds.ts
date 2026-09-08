import type { GameEvent, GameResult, PlayerId } from "../../engine/types";
import { sfx } from "./useSfx";

/**
 * Play the sound effect that belongs to a game event — whoever caused it, in
 * whichever mode. Called from the engine's `dispatch`, so the opponent's synced
 * events sound exactly like your own.
 */
export function playEventSfx(event: GameEvent): void {
  switch (event.type) {
    case "DRAW":
    case "REPLACE_DRAW":
      sfx.play("card-draw");
      break;
    case "END_TURN":
    case "REPLACE":
      sfx.play("card-place");
      break;
    case "ADVANCE_REVEAL":
      sfx.play("card-flip");
      break;
    case "TIMEOUT":
      sfx.play("time-up");
      break;
    case "REMATCH":
      break;
  }
}

/** One-shot sting once the result is in, from `you`'s point of view. */
export function playResultSting(result: GameResult, you: PlayerId): void {
  const w = result.winner;
  sfx.play(w === "draw" ? "draw-game" : w === you ? "win" : "lose");
}
