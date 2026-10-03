import { describe, expect, test } from "vitest";
import type { GameEvent, PlayerId } from "../../../engine/types";
import { isOwnEcho } from "./useOpponentEvents";

type Row = { event: GameEvent & { by: PlayerId }; byIsYou: boolean; own: boolean };

const rows: Row[] = [
  { event: { type: "END_TURN", by: "p1", handIndex: 0, faceDown: false }, byIsYou: true, own: true },
  { event: { type: "END_TURN", by: "p2", handIndex: 0, faceDown: false }, byIsYou: false, own: false },
  { event: { type: "REPLACE", by: "p1", handIndex: null }, byIsYou: true, own: true },
  { event: { type: "REPLACE", by: "p2", handIndex: null }, byIsYou: false, own: false },
  { event: { type: "TIMEOUT", by: "p1", card: { suit: "H", rank: 2 } } as unknown as Row["event"], byIsYou: true, own: false },
  { event: { type: "TIMEOUT", by: "p2", card: { suit: "H", rank: 2 } } as unknown as Row["event"], byIsYou: false, own: true },
  { event: { type: "TIMEOUT_HIDDEN", by: "p1" }, byIsYou: true, own: false },
  { event: { type: "TIMEOUT_HIDDEN", by: "p2" }, byIsYou: false, own: true },
  { event: { type: "FORFEIT", by: "p1" }, byIsYou: true, own: false },
  { event: { type: "FORFEIT", by: "p2" }, byIsYou: false, own: true },
];

describe("isOwnEcho (you = p1)", () => {
  test.each(rows)("$event.type by $event.by -> own echo $own", ({ event, own }) => {
    expect(isOwnEcho(event, "p1")).toBe(own);
  });
});
