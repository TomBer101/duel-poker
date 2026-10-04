import { describe, expect, test } from "vitest";
import {
  generateDealerCommitments,
  generateSelectorCommitments,
  revealCard,
  revealDraw,
  verifyCard,
  verifyDraw,
  derivePlacementSalt,
} from "./protocol";
import { deriveSalt, saltToHex } from "./commitment";
import { DECK_SIZE } from "../engine/constants";

const seed = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);

describe("generateDealerCommitments", () => {
  test("same seed gives identical deck, commitments and salts (deterministic salts)", async () => {
    const a = await generateDealerCommitments(seed);
    const b = await generateDealerCommitments(seed);
    expect(a.deck).toEqual(b.deck);
    expect(a.commitments).toEqual(b.commitments);
    expect(a.salts).toEqual(b.salts);
  });

  test("produces one commitment per card", async () => {
    const { deck, commitments } = await generateDealerCommitments(seed);
    expect(deck).toHaveLength(DECK_SIZE);
    expect(commitments).toHaveLength(DECK_SIZE);
  });
});

describe("generateSelectorCommitments", () => {
  test("same seed gives identical draw order, commitments and salts (deterministic salts)", async () => {
    const a = await generateSelectorCommitments(seed);
    const b = await generateSelectorCommitments(seed);
    expect(a.drawOrder).toEqual(b.drawOrder);
    expect(a.commitments).toEqual(b.commitments);
    expect(a.salts).toEqual(b.salts);
  });

  test("produces one commitment per draw index", async () => {
    const { drawOrder, commitments } = await generateSelectorCommitments(seed);
    expect(drawOrder).toHaveLength(DECK_SIZE);
    expect(commitments).toHaveLength(DECK_SIZE);
  });
});

describe("full commit -> reveal -> verify round trip", () => {
  test("verifies every card and every draw across all 52 positions", async () => {
    const dealerState = await generateDealerCommitments(seed);
    const selectorState = await generateSelectorCommitments(seed);

    for (let i = 0; i < DECK_SIZE; i++) {
      const drawReveal = revealDraw(i, selectorState);
      await expect(verifyDraw(drawReveal, selectorState.commitments[i])).resolves.toBe(
        true,
      );

      const cardReveal = revealCard(drawReveal.position, dealerState);
      await expect(
        verifyCard(cardReveal, dealerState.commitments[drawReveal.position]),
      ).resolves.toBe(true);
    }
  });

  test("detects a tampered card reveal", async () => {
    const dealerState = await generateDealerCommitments(seed);
    const cardReveal = revealCard(0, dealerState);
    const tampered = { ...cardReveal, card: dealerState.deck[1] };
    await expect(verifyCard(tampered, dealerState.commitments[0])).resolves.toBe(false);
  });

  test("detects a tampered salt on a card reveal", async () => {
    const dealerState = await generateDealerCommitments(seed);
    const otherState = await generateDealerCommitments(new Uint8Array([9, 9, 9]));
    const cardReveal = revealCard(0, dealerState);
    const tampered = { ...cardReveal, salt: otherState.salts[0] };
    await expect(verifyCard(tampered, dealerState.commitments[0])).resolves.toBe(false);
  });

  test("detects a tampered draw reveal", async () => {
    const selectorState = await generateSelectorCommitments(seed);
    const drawReveal = revealDraw(0, selectorState);
    const tampered = { ...drawReveal, position: (drawReveal.position + 1) % DECK_SIZE };
    await expect(verifyDraw(tampered, selectorState.commitments[0])).resolves.toBe(
      false,
    );
  });
});

const seed2 = new Uint8Array([16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
const INDICES = [0, 1, 51, 255, 256];

describe("deterministic salts", () => {
  test("different seeds give different commitments and salts", async () => {
    const a = await generateDealerCommitments(seed);
    const b = await generateDealerCommitments(seed2);
    expect(a.commitments).not.toEqual(b.commitments);
    expect(a.salts).not.toEqual(b.salts);
    const c = await generateSelectorCommitments(seed);
    const d = await generateSelectorCommitments(seed2);
    expect(c.salts).not.toEqual(d.salts);
  });

  test("salts are 16 bytes and the three domains never collide for the same index", async () => {
    for (const i of INDICES) {
      const salts = await Promise.all([
        deriveSalt(seed, "deck", i),
        deriveSalt(seed, "draw", i),
        deriveSalt(seed, "place", i, 0),
      ]);
      salts.forEach((s) => expect(s).toHaveLength(16));
      expect(new Set(salts.map(saltToHex)).size).toBe(3);
    }
  });

  test("no two distinct (tag, index) inputs collide", async () => {
    const seen = new Set<string>();
    let n = 0;
    for (const tag of ["deck", "draw", "place"]) {
      for (const i of INDICES) {
        seen.add(saltToHex(await deriveSalt(seed, tag, i)));
        n++;
      }
    }
    expect(seen.size).toBe(n);
  });

  test("tag length prefix disambiguates tag/field boundaries", async () => {
    const x = await deriveSalt(seed, "a", 1);
    const y = await deriveSalt(seed, "ab", 1);
    expect(saltToHex(x)).not.toBe(saltToHex(y));
  });

  test("derivePlacementSalt is deterministic and differs by handIndex and drawIndex", async () => {
    const a = await derivePlacementSalt(seed, 2, 17);
    expect(await derivePlacementSalt(seed, 2, 17)).toEqual(a);
    expect(await derivePlacementSalt(seed, 3, 17)).not.toEqual(a);
    expect(await derivePlacementSalt(seed, 2, 18)).not.toEqual(a);
    expect(await derivePlacementSalt(seed, 17, 2)).not.toEqual(a);
    expect(await derivePlacementSalt(seed2, 2, 17)).not.toEqual(a);
  });

  test("regenerated commitments verify earlier reveals (refresh equivalence)", async () => {
    const first = await generateDealerCommitments(seed);
    const again = await generateDealerCommitments(seed);
    await expect(verifyCard(revealCard(7, again), first.commitments[7])).resolves.toBe(true);
    const sel = await generateSelectorCommitments(seed);
    const sel2 = await generateSelectorCommitments(seed);
    await expect(verifyDraw(revealDraw(9, sel2), sel.commitments[9])).resolves.toBe(true);
  });
});
