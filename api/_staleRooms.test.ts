import { describe, expect, test } from "vitest";
import { staleRoomIds, type RoomsSnapshot } from "./_staleRooms.js";

const HOUR = 60 * 60 * 1000;
const NOW = 100 * HOUR;

describe("staleRoomIds", () => {
  test.each<[string, RoomsSnapshot, string[]]>([
    ["no rooms", null, []],
    ["created 25h ago, never played", { A: { meta: { createdAt: NOW - 25 * HOUR } } }, ["A"]],
    ["created 1h ago", { A: { meta: { createdAt: NOW - HOUR } } }, []],
    ["old room with a recent turn", { A: { meta: { createdAt: NOW - 30 * HOUR, turnStartedAt: NOW - HOUR } } }, []],
    ["old room, last turn 25h ago", { A: { meta: { createdAt: NOW - 30 * HOUR, turnStartedAt: NOW - 25 * HOUR } } }, ["A"]],
    ["half-created room without meta", { A: {} }, ["A"]],
    [
      "only the stale ones of a mix",
      { OLD: { meta: { createdAt: NOW - 48 * HOUR } }, NEW: { meta: { createdAt: NOW - 2 * HOUR } } },
      ["OLD"],
    ],
  ])("%s", (_name, rooms, expected) => {
    expect(staleRoomIds(rooms, NOW, 24 * HOUR)).toEqual(expected);
  });
});
