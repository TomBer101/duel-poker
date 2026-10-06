import { describe, expect, test } from "vitest";
import { commit, generateSalt, generateSeed, verify, saltToHex, hexToSalt } from "./commitment";

describe("generateSalt / generateSeed", () => {
  test("generateSalt returns 16 random bytes", () => {
    const salt = generateSalt();
    expect(salt).toBeInstanceOf(Uint8Array);
    expect(salt.length).toBe(16);
  });

  test("successive calls return different bytes", () => {
    expect(generateSalt()).not.toEqual(generateSalt());
    expect(generateSeed()).not.toEqual(generateSeed());
  });
});

describe("commit / verify", () => {
  test("verify succeeds for a matching value and salt", async () => {
    const salt = generateSalt();
    const commitment = await commit("Hearts-14", salt);
    await expect(verify("Hearts-14", salt, commitment)).resolves.toBe(true);
  });

  test("verify fails when the value was tampered with", async () => {
    const salt = generateSalt();
    const commitment = await commit("Hearts-14", salt);
    await expect(verify("Spades-2", salt, commitment)).resolves.toBe(false);
  });

  test("verify fails when the salt was tampered with", async () => {
    const salt = generateSalt();
    const commitment = await commit("Hearts-14", salt);
    await expect(verify("Hearts-14", generateSalt(), commitment)).resolves.toBe(false);
  });

  test("same value and salt always produce the same commitment", async () => {
    const salt = generateSalt();
    const commitmentA = await commit("Hearts-14", salt);
    const commitmentB = await commit("Hearts-14", salt);
    expect(commitmentA).toBe(commitmentB);
  });

  test("commitment is a hex string", async () => {
    const commitment = await commit("Hearts-14", generateSalt());
    expect(commitment).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("saltToHex / hexToSalt", () => {
  test("round-trips an arbitrary salt", () => {
    const salt = generateSalt();
    expect(hexToSalt(saltToHex(salt))).toEqual(salt);
  });

  test("hex is lowercase, two chars per byte", () => {
    const salt = new Uint8Array([0, 255, 16]);
    expect(saltToHex(salt)).toBe("00ff10");
  });
});
