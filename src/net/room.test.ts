import { describe, expect, test } from "vitest";
import { generateRoomId, hashPassword } from "./room";

describe("generateRoomId", () => {
  test("returns a 6-character alphanumeric code", () => {
    const id = generateRoomId();
    expect(id).toMatch(/^[A-Z0-9]{6}$/);
  });

  test("successive calls are not always the same", () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateRoomId()));
    expect(ids.size).toBeGreaterThan(1);
  });
});

describe("hashPassword", () => {
  test("same password and room produce the same hash", async () => {
    const a = await hashPassword("secret", "ROOM01");
    const b = await hashPassword("secret", "ROOM01");
    expect(a).toBe(b);
  });

  test("different rooms produce different hashes for the same password", async () => {
    const a = await hashPassword("secret", "ROOM01");
    const b = await hashPassword("secret", "ROOM02");
    expect(a).not.toBe(b);
  });

  test("different passwords produce different hashes", async () => {
    const a = await hashPassword("secret", "ROOM01");
    const b = await hashPassword("other", "ROOM01");
    expect(a).not.toBe(b);
  });
});
