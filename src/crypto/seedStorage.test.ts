import { beforeEach, describe, expect, test } from "vitest";
import { loadSeed, saveSeed } from "./seedStorage";

beforeEach(() => {
  localStorage.clear();
});

describe("saveSeed / loadSeed", () => {
  test("round-trips a seed for a room, game number and player", () => {
    const seed = new Uint8Array([1, 2, 3, 4]);
    saveSeed("room-1", 1, "p1", seed);
    expect(loadSeed("room-1", 1, "p1")).toEqual(seed);
  });

  test("returns null when nothing was saved", () => {
    expect(loadSeed("room-1", 1, "p1")).toBeNull();
  });

  test("keys are independent per room, game number and player", () => {
    saveSeed("room-1", 1, "p1", new Uint8Array([1]));
    saveSeed("room-1", 2, "p1", new Uint8Array([2]));
    saveSeed("room-2", 1, "p1", new Uint8Array([3]));
    saveSeed("room-1", 1, "p2", new Uint8Array([4]));

    expect(loadSeed("room-1", 1, "p1")).toEqual(new Uint8Array([1]));
    expect(loadSeed("room-1", 2, "p1")).toEqual(new Uint8Array([2]));
    expect(loadSeed("room-2", 1, "p1")).toEqual(new Uint8Array([3]));
    expect(loadSeed("room-1", 1, "p2")).toEqual(new Uint8Array([4]));
  });
});
