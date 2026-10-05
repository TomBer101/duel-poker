import { beforeEach, describe, expect, test } from "vitest";
import { loadSeed, saveSeed } from "./seedStorage";

beforeEach(() => {
  localStorage.clear();
});

const seedOf = (n: number) => new Uint8Array(16).fill(n);

describe("saveSeed / loadSeed", () => {
  test("round-trips a seed for a room, game number and player", () => {
    const seed = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    saveSeed("room-1", 1, "p1", seed);
    expect(loadSeed("room-1", 1, "p1")).toEqual(seed);
  });

  test("returns null when nothing was saved", () => {
    expect(loadSeed("room-1", 1, "p1")).toBeNull();
  });

  test("keys are independent per room, game number and player", () => {
    saveSeed("room-1", 1, "p1", seedOf(1));
    saveSeed("room-1", 2, "p1", seedOf(2));
    saveSeed("room-2", 1, "p1", seedOf(3));
    saveSeed("room-1", 1, "p2", seedOf(4));

    expect(loadSeed("room-1", 1, "p1")).toEqual(seedOf(1));
    expect(loadSeed("room-1", 2, "p1")).toEqual(seedOf(2));
    expect(loadSeed("room-2", 1, "p1")).toEqual(seedOf(3));
    expect(loadSeed("room-1", 1, "p2")).toEqual(seedOf(4));
  });

  test.each([
    ["too short", JSON.stringify(Array(15).fill(1))],
    ["too long", JSON.stringify(Array(17).fill(1))],
    ["empty", "[]"],
    ["not a byte", JSON.stringify([...Array(15).fill(1), 256])],
    ["not a list", '"abc"'],
    ["not JSON", "{oops"],
  ])("a stored seed that is %s is treated as missing", (_, raw) => {
    localStorage.setItem("duelPoker-room-1:1:p1", raw);
    expect(loadSeed("room-1", 1, "p1")).toBeNull();
  });
});
