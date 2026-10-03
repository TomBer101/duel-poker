# Phase 7 — Multiplayer Game Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two players can play a full Chinese Poker game end to end over
Firebase RTDB — commit-reveal shuffle, draws, placements, replace, reveal,
result, rematch — with turn timeouts, disconnect handling, and refresh
recovery.

**Architecture:** A pure, Firebase-free **protocol controller**
(`src/crypto/protocolController.ts`) verifies commit-reveal messages and
resolves them into plain cards. A new **`useMultiplayerGame`** hook wires
the controller + Firebase subscriptions (`src/net/sync.ts`,
`src/net/roomState.ts`) to the existing, untouched `useGameEngine` /
`gameReducer`, dispatching ordinary `GameEvent`s exactly as `useSoloGame`
does today. `GameScreen` picks solo or multiplayer by route.

**Tech Stack:** React, TypeScript, Firebase RTDB (`firebase/database`),
Vitest + `@firebase/rules-unit-testing` emulator for `net/`, Testing Library
for hooks/components.

**Spec:** [docs/superpowers/specs/2026-09-22-phase-7-multiplayer-game-loop-design.md](../specs/2026-09-22-phase-7-multiplayer-game-loop-design.md)

## Global Constraints

- Package manager is **pnpm**; test with `pnpm test <file>`.
- `gameReducer` and `GameEvent` (`src/engine/`) are **not modified** — this
  is a hard constraint from the spec and from `CLAUDE.md`'s layering rule
  (`engine/` depends on nothing).
- `crypto/` may depend on `engine/` only, never on `net/` or `firebase/*`.
  `protocolController.ts` must have zero Firebase imports.
- `net/` is the only layer that imports `firebase/database`.
- Emulator tests follow the existing pattern in `src/net/sync.emulator.test.ts`
  (`connectToEmulators` + `signInAnonymous` + a fresh `roomId` per test via
  an incrementing counter) — copy that boilerplate, don't invent a new one.
- Every new hook/component file gets a co-located `.test.ts`/`.test.tsx`.
- Ace is rank 14; `cardId()` (already in `src/engine/deck.ts`) is the stable
  string id used in every hash — reuse it, don't reinvent card serialization.

---

### Task 1: Salt hex encoding

**Files:**
- Modify: `src/crypto/commitment.ts`
- Test: `src/crypto/commitment.test.ts` (already exists — add cases)

**Interfaces:**
- Produces: `saltToHex(salt: Uint8Array): string`,
  `hexToSalt(hex: string): Uint8Array` — Firebase RTDB can't store
  `Uint8Array`, so every salt crossing the wire is hex first.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/crypto/commitment.test.ts
import { generateSalt, hexToSalt, saltToHex } from "./commitment";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/crypto/commitment.test.ts`
Expected: FAIL — `saltToHex`/`hexToSalt` not exported.

- [ ] **Step 3: Implement**

```ts
// add to src/crypto/commitment.ts
export function saltToHex(salt: Uint8Array): string {
  return Array.from(salt)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToSalt(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/crypto/commitment.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/crypto/commitment.ts src/crypto/commitment.test.ts
git commit -m "feat(crypto): hex encode/decode salts for wire transport"
```

---

### Task 2: Protocol controller

**Files:**
- Create: `src/crypto/protocolController.ts`
- Test: `src/crypto/protocolController.test.ts`

**Interfaces:**
- Consumes: `commit`, `verify` (`src/crypto/commitment.ts`), `cardId`
  (`src/engine/deck.ts`), `Card` (`src/engine/types.ts`).
- Produces:
  - `type ProtocolControllerState = { dealerCommitments: string[] | null; selectorCommitments: string[] | null; positions: Record<number, number>; cards: Record<number, Card>; violations: string[] }`
  - `createProtocolState(): ProtocolControllerState`
  - `setCommitments(state, role: "dealer" | "selector", commitments: string[]): ProtocolControllerState`
  - `applyPositionReveal(state, drawIndex: number, position: number, salt: Uint8Array): Promise<ProtocolControllerState>`
  - `applyCardReveal(state, position: number, card: Card, salt: Uint8Array): Promise<ProtocolControllerState>`
  - `resolvedDraw(state, drawIndex: number): Card | null`
  - `hasViolation(state: ProtocolControllerState): boolean`
  - These are consumed by Task 5/6's `useMultiplayerGame`.

- [ ] **Step 1: Write the failing test**

```ts
// src/crypto/protocolController.test.ts
import { describe, expect, test } from "vitest";
import {
  applyCardReveal,
  applyPositionReveal,
  createProtocolState,
  hasViolation,
  resolvedDraw,
  setCommitments,
} from "./protocolController";
import { generateDealerCommitments, generateSelectorCommitments } from "./protocol";
import { generateSeed } from "./commitment";

describe("protocolController", () => {
  test("resolves a draw once both halves verify", async () => {
    const dealer = await generateDealerCommitments(generateSeed());
    const selector = await generateSelectorCommitments(generateSeed());

    let state = createProtocolState();
    state = setCommitments(state, "dealer", dealer.commitments);
    state = setCommitments(state, "selector", selector.commitments);

    const drawIndex = 0;
    const position = selector.drawOrder[drawIndex];
    state = await applyPositionReveal(state, drawIndex, position, selector.salts[drawIndex]);
    expect(resolvedDraw(state, drawIndex)).toBeNull(); // card half still missing

    const card = dealer.deck[position];
    state = await applyCardReveal(state, position, card, dealer.salts[position]);

    expect(resolvedDraw(state, drawIndex)).toEqual(card);
    expect(hasViolation(state)).toBe(false);
  });

  test("rejects a tampered position reveal", async () => {
    const selector = await generateSelectorCommitments(generateSeed());
    let state = createProtocolState();
    state = setCommitments(state, "selector", selector.commitments);

    const wrongPosition = (selector.drawOrder[0] + 1) % 52;
    state = await applyPositionReveal(state, 0, wrongPosition, selector.salts[0]);

    expect(hasViolation(state)).toBe(true);
    expect(resolvedDraw(state, 0)).toBeNull();
  });

  test("rejects a tampered card reveal", async () => {
    const dealer = await generateDealerCommitments(generateSeed());
    let state = createProtocolState();
    state = setCommitments(state, "dealer", dealer.commitments);

    const position = 3;
    const wrongCard = dealer.deck[(position + 1) % 52];
    state = await applyCardReveal(state, position, wrongCard, dealer.salts[position]);

    expect(hasViolation(state)).toBe(true);
  });

  test("card reveal before commitments are known is a violation, not a throw", async () => {
    const state = await applyCardReveal(
      createProtocolState(),
      0,
      { suit: "Hearts", rank: 14 },
      new Uint8Array(16),
    );
    expect(hasViolation(state)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/crypto/protocolController.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```ts
// src/crypto/protocolController.ts
import { verify } from "./commitment";
import { cardId } from "../engine/deck";
import type { Card } from "../engine/types";

export type ProtocolRole = "dealer" | "selector";

export type ProtocolControllerState = {
  dealerCommitments: string[] | null;
  selectorCommitments: string[] | null;
  /** drawIndex -> deck position, once the selector's reveal verifies. */
  positions: Record<number, number>;
  /** deck position -> card, once the dealer's reveal verifies. */
  cards: Record<number, Card>;
  /** Human-readable verification failures. Non-empty halts the game. */
  violations: string[];
};

export function createProtocolState(): ProtocolControllerState {
  return {
    dealerCommitments: null,
    selectorCommitments: null,
    positions: {},
    cards: {},
    violations: [],
  };
}

export function setCommitments(
  state: ProtocolControllerState,
  role: ProtocolRole,
  commitments: string[],
): ProtocolControllerState {
  return role === "dealer"
    ? { ...state, dealerCommitments: commitments }
    : { ...state, selectorCommitments: commitments };
}

function withViolation(state: ProtocolControllerState, message: string): ProtocolControllerState {
  return { ...state, violations: [...state.violations, message] };
}

/** The selector reveals which deck position a draw index maps to. */
export async function applyPositionReveal(
  state: ProtocolControllerState,
  drawIndex: number,
  position: number,
  salt: Uint8Array,
): Promise<ProtocolControllerState> {
  const commitment = state.selectorCommitments?.[drawIndex];
  if (!commitment) {
    return withViolation(state, `no selector commitment for draw index ${drawIndex}`);
  }
  const ok = await verify(String(position), salt, commitment);
  if (!ok) {
    return withViolation(state, `position reveal failed verification for draw index ${drawIndex}`);
  }
  return { ...state, positions: { ...state.positions, [drawIndex]: position } };
}

/** The dealer reveals the card at a deck position. */
export async function applyCardReveal(
  state: ProtocolControllerState,
  position: number,
  card: Card,
  salt: Uint8Array,
): Promise<ProtocolControllerState> {
  const commitment = state.dealerCommitments?.[position];
  if (!commitment) {
    return withViolation(state, `no dealer commitment for position ${position}`);
  }
  const ok = await verify(cardId(card), salt, commitment);
  if (!ok) {
    return withViolation(state, `card reveal failed verification for position ${position}`);
  }
  return { ...state, cards: { ...state.cards, [position]: card } };
}

/** The card for `drawIndex`, once both its position and card reveals verify. */
export function resolvedDraw(state: ProtocolControllerState, drawIndex: number): Card | null {
  const position = state.positions[drawIndex];
  if (position === undefined) return null;
  return state.cards[position] ?? null;
}

export function hasViolation(state: ProtocolControllerState): boolean {
  return state.violations.length > 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/crypto/protocolController.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/crypto/protocolController.ts src/crypto/protocolController.test.ts
git commit -m "feat(crypto): protocol controller verifies commit-reveal draws outside the reducer"
```

---

### Task 3: Sync layer — commitments and reveals

**Files:**
- Modify: `src/net/sync.ts`
- Test: `src/net/sync.emulator.test.ts` (add describe blocks)

**Interfaces:**
- Consumes: existing `firebase/database` helpers already imported in
  `sync.ts` (`push`, `ref`, `set`, `onValue`, `onChildAdded`), `PlayerId`
  from `engine/types`.
- Produces:
  - `type ProtocolRole = "dealer" | "selector"`
  - `publishCommitments(db, roomId, role, commitments: string[]): Promise<void>`
  - `subscribeToCommitments(db, roomId, role, callback: (commitments: string[]) => void): () => void`
  - `type ProtocolReveal = { kind: "position"; by: PlayerId; drawIndex: number; position: number; saltHex: string } | { kind: "card"; by: PlayerId; position: number; cardId: string; saltHex: string } | { kind: "placementCommit"; by: PlayerId; handIndex: number; commitment: string } | { kind: "placementReveal"; by: PlayerId; handIndex: number; cardId: string; saltHex: string }`
  - `publishReveal(db, roomId, reveal: ProtocolReveal): Promise<void>`
  - `subscribeToReveals(db, roomId, callback: (reveal: ProtocolReveal) => void): () => void`
  - Consumed by Task 5/6's `useMultiplayerGame`.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/net/sync.emulator.test.ts
import {
  publishCommitments,
  publishReveal,
  subscribeToCommitments,
  subscribeToReveals,
  type ProtocolReveal,
} from "./sync";

describe("publishCommitments / subscribeToCommitments", () => {
  test("delivers a role's commitments when they're written", async () => {
    const received: string[][] = [];
    const unsubscribe = subscribeToCommitments(db, roomId, "dealer", (c) => received.push(c));

    await publishCommitments(db, roomId, "dealer", ["h0", "h1"]);

    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toEqual(["h0", "h1"]);
    unsubscribe();
  });
});

describe("publishReveal / subscribeToReveals", () => {
  test("delivers reveals in publish order", async () => {
    const received: ProtocolReveal[] = [];
    const unsubscribe = subscribeToReveals(db, roomId, (r) => received.push(r));

    const position: ProtocolReveal = {
      kind: "position",
      by: "p2",
      drawIndex: 0,
      position: 17,
      saltHex: "aa",
    };
    const card: ProtocolReveal = {
      kind: "card",
      by: "p1",
      position: 17,
      cardId: "Spades-7",
      saltHex: "bb",
    };
    await publishReveal(db, roomId, position);
    await publishReveal(db, roomId, card);

    await vi.waitFor(() => expect(received).toHaveLength(2));
    expect(received).toEqual([position, card]);
    unsubscribe();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/net/sync.emulator.test.ts` (requires the Firebase
emulator — see existing `pnpm`-scripted emulator setup used by the other
`*.emulator.test.ts` files)
Expected: FAIL — new exports don't exist.

- [ ] **Step 3: Implement**

```ts
// add to src/net/sync.ts
export type ProtocolRole = "dealer" | "selector";

/** Publishes one role's 52 commitment hashes for the current game's shuffle. */
export async function publishCommitments(
  db: Database,
  roomId: string,
  role: ProtocolRole,
  commitments: string[],
): Promise<void> {
  await set(ref(db, `rooms/${roomId}/protocol/commitments/${role}`), commitments);
}

/** Fires `callback` with a role's commitments whenever they're written. */
export function subscribeToCommitments(
  db: Database,
  roomId: string,
  role: ProtocolRole,
  callback: (commitments: string[]) => void,
): () => void {
  const commitmentsRef = ref(db, `rooms/${roomId}/protocol/commitments/${role}`);
  return onValue(commitmentsRef, (snapshot) => {
    const value = snapshot.val() as string[] | null;
    if (value) callback(value);
  });
}

/**
 * One commit-reveal wire message. `position`/`card` reveal a draw index's
 * deck position and the card at it (verified independently — see
 * `protocolController.ts`). `placementCommit`/`placementReveal` cover the
 * dealer's face-down 5th card, which the dealer already knows and places
 * secretly: a hash now, the real card only in the reveal phase.
 */
export type ProtocolReveal =
  | { kind: "position"; by: PlayerId; drawIndex: number; position: number; saltHex: string }
  | { kind: "card"; by: PlayerId; position: number; cardId: string; saltHex: string }
  | { kind: "placementCommit"; by: PlayerId; handIndex: number; commitment: string }
  | { kind: "placementReveal"; by: PlayerId; handIndex: number; cardId: string; saltHex: string };

/** Appends a protocol message under /rooms/{roomId}/protocol/reveals. */
export async function publishReveal(
  db: Database,
  roomId: string,
  reveal: ProtocolReveal,
): Promise<void> {
  const revealRef = push(ref(db, `rooms/${roomId}/protocol/reveals`));
  await set(revealRef, reveal);
}

/** Fires `callback` once per protocol message, in append order. */
export function subscribeToReveals(
  db: Database,
  roomId: string,
  callback: (reveal: ProtocolReveal) => void,
): () => void {
  const revealsRef = ref(db, `rooms/${roomId}/protocol/reveals`);
  return onChildAdded(revealsRef, (snapshot) => {
    callback(snapshot.val() as ProtocolReveal);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/net/sync.emulator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/net/sync.ts src/net/sync.emulator.test.ts
git commit -m "feat(net): publish/subscribe commitments and commit-reveal messages"
```

---

### Task 4: Room state helpers — turn clock, dealer role, rematch, score

**Files:**
- Create: `src/net/roomState.ts`
- Test: `src/net/roomState.emulator.test.ts`

**Interfaces:**
- Consumes: `Database` (`firebase/database`), `PlayerId` (`engine/types`).
- Produces:
  - `publishTurnStarted(db, roomId): Promise<void>` — writes
    `meta/turnStartedAt` as `ServerValue.TIMESTAMP`.
  - `subscribeToTurnStarted(db, roomId, callback: (at: number) => void): () => void`
  - `publishDealer(db, roomId, dealer: PlayerId): Promise<void>` /
    `subscribeToDealer(db, roomId, callback: (dealer: PlayerId) => void): () => void`
  - `publishRematchVote(db, roomId, player: PlayerId): Promise<void>` /
    `subscribeToRematch(db, roomId, callback: (votes: Partial<Record<PlayerId, boolean>>) => void): () => void`
  - `incrementScore(db, roomId, winner: PlayerId): Promise<void>` /
    `subscribeToScore(db, roomId, callback: (score: Record<PlayerId, number>) => void): () => void`
  - `resetForRematch(db, roomId, nextDealer: PlayerId, nextGameNumber: number): Promise<void>` —
    clears `events`, `protocol`, `rematch`, sets `meta.turn`, `protocol.dealer` /
    `meta.turnStartedAt`, `gameNumber` in one multi-path `update`.
  - `subscribeToGameNumber(db, roomId, callback: (n: number) => void): () => void`
  - Consumed by Task 6 (turn clock reset on every `END_TURN`/`REPLACE`),
    Task 8 (timer), Task 11 (rematch), Task 12 (score).

- [ ] **Step 1: Write the failing test**

```ts
// src/net/roomState.emulator.test.ts
import { beforeEach, describe, expect, test, vi } from "vitest";
import { get, ref, type Database } from "firebase/database";
import { connectToEmulators, createFirebaseClient, signInAnonymous } from "./firebase";
import {
  incrementScore,
  publishDealer,
  publishRematchVote,
  publishTurnStarted,
  resetForRematch,
  subscribeToDealer,
  subscribeToRematch,
  subscribeToScore,
  subscribeToTurnStarted,
} from "./roomState";

const dummyConfig = {
  apiKey: "test-api-key",
  authDomain: "test.firebaseapp.com",
  databaseURL: "https://test-default-rtdb.firebaseio.com",
  projectId: "test-project",
  storageBucket: "test.appspot.com",
  messagingSenderId: "0",
  appId: "1:0:web:0",
};

let db: Database;
let roomId: string;
let appCounter = 0;

beforeEach(async () => {
  const client = createFirebaseClient(dummyConfig, `roomstate-test-${appCounter}`);
  connectToEmulators(client);
  await signInAnonymous(client.auth);
  db = client.db;
  roomId = `RSTATE${appCounter}`;
  appCounter++;
});

test("publishTurnStarted sets a server timestamp subscribers observe", async () => {
  // The RTDB client SDK fires onValue twice for a serverTimestamp() write:
  // once immediately with a locally-estimated value, again when the
  // server's real value round-trips back. Real consumers (Task 8's
  // useRemoteTimer) only ever care about the latest value, so the test
  // asserts on `seen.at(-1)`, not on how many times the callback fired.
  const seen: number[] = [];
  const unsubscribe = subscribeToTurnStarted(db, roomId, (at) => seen.push(at));
  await publishTurnStarted(db, roomId);
  await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
  expect(seen.at(-1)).toBeGreaterThan(0);
  unsubscribe();
});

test("publishDealer / subscribeToDealer", async () => {
  const seen: string[] = [];
  const unsubscribe = subscribeToDealer(db, roomId, (d) => seen.push(d));
  await publishDealer(db, roomId, "p2");
  await vi.waitFor(() => expect(seen).toEqual(["p2"]));
  unsubscribe();
});

test("publishRematchVote / subscribeToRematch", async () => {
  const seen: Record<string, boolean>[] = [];
  const unsubscribe = subscribeToRematch(db, roomId, (v) => seen.push(v));
  await publishRematchVote(db, roomId, "p1");
  await vi.waitFor(() => expect(seen.at(-1)).toEqual({ p1: true }));
  unsubscribe();
});

test("incrementScore / subscribeToScore accumulates per player", async () => {
  const seen: Record<string, number>[] = [];
  const unsubscribe = subscribeToScore(db, roomId, (s) => seen.push(s));
  await incrementScore(db, roomId, "p1");
  await incrementScore(db, roomId, "p1");
  await incrementScore(db, roomId, "p2");
  await vi.waitFor(() => expect(seen.at(-1)).toEqual({ p1: 2, p2: 1 }));
  unsubscribe();
});

test("resetForRematch clears events/protocol/rematch and sets the next dealer", async () => {
  await publishRematchVote(db, roomId, "p1");
  await publishRematchVote(db, roomId, "p2");

  await resetForRematch(db, roomId, "p2", 2);

  const rematch = await get(ref(db, `rooms/${roomId}/rematch`));
  expect(rematch.val()).toBeNull();
  const dealer = await get(ref(db, `rooms/${roomId}/protocol/dealer`));
  expect(dealer.val()).toBe("p2");
  const gameNumber = await get(ref(db, `rooms/${roomId}/gameNumber`));
  expect(gameNumber.val()).toBe(2);
  const turn = await get(ref(db, `rooms/${roomId}/meta/turn`));
  expect(turn.val()).toBe("p2");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/net/roomState.emulator.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```ts
// src/net/roomState.ts
import { get, ref, serverTimestamp, set, update, onValue, type Database } from "firebase/database";
import type { PlayerId } from "../engine/types";

export async function publishTurnStarted(db: Database, roomId: string): Promise<void> {
  await set(ref(db, `rooms/${roomId}/meta/turnStartedAt`), serverTimestamp());
}

export function subscribeToTurnStarted(
  db: Database,
  roomId: string,
  callback: (at: number) => void,
): () => void {
  const r = ref(db, `rooms/${roomId}/meta/turnStartedAt`);
  return onValue(r, (snapshot) => {
    const value = snapshot.val() as number | null;
    if (value) callback(value);
  });
}

export async function publishDealer(db: Database, roomId: string, dealer: PlayerId): Promise<void> {
  await set(ref(db, `rooms/${roomId}/protocol/dealer`), dealer);
}

export function subscribeToDealer(
  db: Database,
  roomId: string,
  callback: (dealer: PlayerId) => void,
): () => void {
  const r = ref(db, `rooms/${roomId}/protocol/dealer`);
  return onValue(r, (snapshot) => {
    const value = snapshot.val() as PlayerId | null;
    if (value) callback(value);
  });
}

export async function publishRematchVote(db: Database, roomId: string, player: PlayerId): Promise<void> {
  await set(ref(db, `rooms/${roomId}/rematch/${player}`), true);
}

export function subscribeToRematch(
  db: Database,
  roomId: string,
  callback: (votes: Partial<Record<PlayerId, boolean>>) => void,
): () => void {
  const r = ref(db, `rooms/${roomId}/rematch`);
  return onValue(r, (snapshot) => {
    callback((snapshot.val() as Partial<Record<PlayerId, boolean>>) ?? {});
  });
}

/** Reads/increments under a transaction-free "read then write" — good enough
 *  for this game's low write contention (one increment per game, on the
 *  client that just computed the result). */
export async function incrementScore(db: Database, roomId: string, winner: PlayerId): Promise<void> {
  const snapshot = await get(ref(db, `rooms/${roomId}/score/${winner}`));
  const current = (snapshot.val() as number | null) ?? 0;
  await set(ref(db, `rooms/${roomId}/score/${winner}`), current + 1);
}

export function subscribeToScore(
  db: Database,
  roomId: string,
  callback: (score: Record<PlayerId, number>) => void,
): () => void {
  const r = ref(db, `rooms/${roomId}/score`);
  return onValue(r, (snapshot) => {
    const value = (snapshot.val() as Partial<Record<PlayerId, number>>) ?? {};
    callback({ p1: value.p1 ?? 0, p2: value.p2 ?? 0 });
  });
}

export function subscribeToGameNumber(
  db: Database,
  roomId: string,
  callback: (gameNumber: number) => void,
): () => void {
  const r = ref(db, `rooms/${roomId}/gameNumber`);
  return onValue(r, (snapshot) => {
    callback((snapshot.val() as number | null) ?? 1);
  });
}

/**
 * Starts the next game in the same room: clears the event and protocol logs
 * and the rematch votes, flips the dealer role, and sets the new game
 * number and turn — all as one multi-path update.
 */
export async function resetForRematch(
  db: Database,
  roomId: string,
  nextDealer: PlayerId,
  nextGameNumber: number,
): Promise<void> {
  await update(ref(db, `rooms/${roomId}`), {
    events: null,
    protocol: { dealer: nextDealer },
    rematch: null,
    gameNumber: nextGameNumber,
    "meta/turn": nextDealer,
    "meta/turnStartedAt": serverTimestamp(),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/net/roomState.emulator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/net/roomState.ts src/net/roomState.emulator.test.ts
git commit -m "feat(net): room state helpers for turn clock, dealer role, rematch, score"
```

---

### Task 5: `useMultiplayerGame` — shuffling phase and opening deal

**Files:**
- Create: `vitest.emulator.jsdom.config.ts` (Step 0 — new test infra, see below)
- Modify: `package.json` (Step 0 — new `test:emulator:ui` script)
- Modify: `vitest.config.ts` (Step 0 — confirm/extend the exclude pattern)
- Create: `src/ui/hooks/useMultiplayerGame.ts`
- Test: `src/ui/hooks/useMultiplayerGame.emulator.test.ts`

**Interfaces:**
- Consumes: `useGameEngine` (`ui/hooks/useGameEngine.ts`),
  `generateDealerCommitments`/`generateSelectorCommitments`/`revealDraw`/`revealCard`
  (`crypto/protocol.ts`), `createProtocolState`/`setCommitments`/
  `applyPositionReveal`/`applyCardReveal`/`resolvedDraw`/`hasViolation`
  (`crypto/protocolController.ts`), `saltToHex`/`hexToSalt`/`generateSeed`
  (`crypto/commitment.ts`), `publishCommitments`/`subscribeToCommitments`/
  `publishReveal`/`subscribeToReveals` (`net/sync.ts`), `publishDealer`/
  `subscribeToDealer`/`publishTurnStarted` (`net/roomState.ts`),
  `saveSeed`/`loadSeed` (`crypto/seedStorage.ts`), `HANDS_PER_PLAYER`
  (`engine/constants.ts`), `otherPlayer`/`cardId` (`engine/deck.ts`).
- Produces (this task; extended by Tasks 6-14):
  - `export type MultiplayerGameOptions = { db: Database; roomId: string; you: PlayerId; gameNumber: number }`
  - `export function useMultiplayerGame(opts: MultiplayerGameOptions): { state: GameState; getEvents: () => readonly GameEvent[] }`
    (the return type grows in Task 6 to match `SoloGame`'s shape).
- Design decision locked in here: **opening-deal draw indices.** Draw
  indices `0..9` are the opening deal, mapped `0→p1 hand0, 1→p2 hand0,
  2→p1 hand1, 3→p2 hand1, … 8→p1 hand4, 9→p2 hand4` (alternating,
  fill-evenly). Once all 10 resolve, the hook dispatches one `DEAL` event
  built from them — never 10 individual `DRAW`s. This task only handles
  reaching that point (role + commitment exchange + collecting the 10
  opening reveals); per-turn drawing is Task 6.

**Test infrastructure gap, close this first:** this task's test needs BOTH
jsdom/React (for `renderHook`) AND a running Firebase emulator (for
`createFirebaseClient`/`connectToEmulators`). Neither existing vitest
config provides both: `vitest.config.ts` has jsdom+React but excludes
`*.emulator.test.ts` and never starts an emulator; `vitest.emulator.config.ts`
starts the emulator (via `pnpm test:emulator`'s `firebase emulators:exec`
wrapper) but runs with `environment: "node"` and no React plugin, meant for
`src/net/`'s plain-function tests. Add a third config and script before
writing this task's test.

- [ ] **Step 0: Add the jsdom+emulator test config**

```ts
// vitest.emulator.jsdom.config.ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Like vitest.emulator.config.ts (real Firebase emulator via
// `firebase emulators:exec`), but for src/ui/ hook tests that also need
// jsdom + the React plugin for `renderHook`. Kept separate from that file
// rather than added to it, so a plain `src/net/` emulator test run never
// pays for jsdom/React it doesn't need.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": "/src" },
  },
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/ui/**/*.emulator.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
  },
});
```

```json
// add to package.json's "scripts" (alongside the existing "test:emulator")
"test:emulator:ui": "firebase emulators:exec --only auth,database \"vitest run --config vitest.emulator.jsdom.config.ts\""
```

Also add `"src/ui/**/*.emulator.test.ts"` to `vitest.config.ts`'s existing
`exclude` array (next to `"src/**/*.emulator.test.ts"`, which already
covers this by prefix — check whether that existing pattern already
excludes it; if `src/**/*.emulator.test.ts` matches `src/ui/hooks/foo.emulator.test.ts`
too, as glob semantics suggest, no change is needed there — verify with
`pnpm test` after Step 1 creates the new test file, confirming plain
`pnpm test` does NOT try to run it).

- [ ] **Step 0b: Verify the new script runs (against an empty test file)**

Create an empty placeholder at `src/ui/hooks/useMultiplayerGame.emulator.test.ts`
containing just `import { test } from "vitest"; test.skip("placeholder", () => {});`,
run `pnpm test:emulator:ui`, confirm it starts the emulator and reports 1
skipped test with no config errors, then replace the placeholder with
Step 1's real content below.

- [ ] **Step 1: Write the failing test**

```ts
// src/ui/hooks/useMultiplayerGame.emulator.test.ts
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, beforeEach, vi } from "vitest";
import { connectToEmulators, createFirebaseClient, signInAnonymous } from "../../net/firebase";
import { publishDealer } from "../../net/roomState";
import { useMultiplayerGame } from "./useMultiplayerGame";
import type { Database } from "firebase/database";

const dummyConfig = {
  apiKey: "test-api-key",
  authDomain: "test.firebaseapp.com",
  databaseURL: "https://test-default-rtdb.firebaseio.com",
  projectId: "test-project",
  storageBucket: "test.appspot.com",
  messagingSenderId: "0",
  appId: "1:0:web:0",
};

let db: Database;
let roomId: string;
let appCounter = 0;

beforeEach(async () => {
  const client = createFirebaseClient(dummyConfig, `mpgame-test-${appCounter}`);
  connectToEmulators(client);
  await signInAnonymous(client.auth);
  db = client.db;
  roomId = `MPGAME${appCounter}`;
  appCounter++;
});

describe("useMultiplayerGame — shuffling and opening deal", () => {
  test("both players end the opening deal with 10 cards dealt, dealer's deck order", async () => {
    await publishDealer(db, roomId, "p1");

    const p1 = renderHook(() => useMultiplayerGame({ db, roomId, you: "p1", gameNumber: 1 }));
    const p2 = renderHook(() => useMultiplayerGame({ db, roomId, you: "p2", gameNumber: 1 }));

    await waitFor(
      () => {
        expect(p1.result.current.state.drawCount).toBe(10);
        expect(p2.result.current.state.drawCount).toBe(10);
      },
      { timeout: 5000 },
    );

    // Both clients replayed the same verified deal.
    expect(p1.result.current.state.hands).toEqual(p2.result.current.state.hands);
    expect(p1.result.current.state.phase).toBe("placing");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:emulator:ui` (runs every *.emulator.test.ts under src/ui via the jsdom+emulator config added in Task 5 Step 0)
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```ts
// src/ui/hooks/useMultiplayerGame.ts
import { useEffect, useRef, useState } from "react";
import type { Database } from "firebase/database";
import { HANDS_PER_PLAYER } from "../../engine/constants";
import { cardId, otherPlayer } from "../../engine/deck";
import type { Card, GameEvent, GameState, PlayerId } from "../../engine/types";
import {
  generateSalt,
  generateSeed,
  hexToSalt,
  saltToHex,
} from "../../crypto/commitment";
import {
  generateDealerCommitments,
  generateSelectorCommitments,
  revealCard,
  revealDraw,
  type DealerCommitmentState,
  type SelectorCommitmentState,
} from "../../crypto/protocol";
import {
  applyCardReveal,
  applyPositionReveal,
  createProtocolState,
  hasViolation,
  resolvedDraw,
  setCommitments,
  type ProtocolControllerState,
} from "../../crypto/protocolController";
import { loadSeed, saveSeed } from "../../crypto/seedStorage";
import {
  publishCommitments,
  publishReveal,
  subscribeToCommitments,
  subscribeToReveals,
  type ProtocolReveal,
} from "../../net/sync";
import { publishDealer, publishTurnStarted, subscribeToDealer } from "../../net/roomState";
import { useGameEngine } from "./useGameEngine";

export type MultiplayerGameOptions = {
  db: Database;
  roomId: string;
  you: PlayerId;
  /** Distinguishes seeds/log state across rematches in the same room. */
  gameNumber: number;
};

/** Deal draw index -> which player/hand it fills. Alternates for fill-evenly. */
const DEAL_SLOTS: { player: PlayerId; hand: number }[] = Array.from(
  { length: HANDS_PER_PLAYER * 2 },
  (_, i) => ({ player: (i % 2 === 0 ? "p1" : "p2") as PlayerId, hand: Math.floor(i / 2) }),
);

export function useMultiplayerGame(opts: MultiplayerGameOptions) {
  const { db, roomId, you, gameNumber } = opts;
  const [dealer, setDealer] = useState<PlayerId | null>(null);
  const { state, dispatch, getEvents } = useGameEngine({ mode: "multiplayer", firstTurn: "p1" });

  const role = dealer ? (dealer === you ? "dealer" : "selector") : null;
  const dealerState = useRef<DealerCommitmentState | null>(null);
  const selectorState = useRef<SelectorCommitmentState | null>(null);
  const protocol = useRef<ProtocolControllerState>(createProtocolState());
  const dealBuffer = useRef<Map<number, Card>>(new Map());
  const dealt = useRef(false);
  const publishedPosition = useRef<Set<number>>(new Set());
  const publishedCard = useRef<Set<number>>(new Set());

  // Who's dealer this game — read once at mount (set by the room creator /
  // rematch flow before either client mounts this hook).
  useEffect(() => subscribeToDealer(db, roomId, setDealer), [db, roomId]);

  // Generate my half of the shuffle and publish my 52 commitments.
  useEffect(() => {
    if (!role) return;
    let cancelled = false;
    (async () => {
      let seed = loadSeed(roomId, gameNumber);
      if (!seed) {
        seed = generateSeed();
        saveSeed(roomId, gameNumber, seed);
      }
      if (role === "dealer") {
        const s = await generateDealerCommitments(seed);
        if (cancelled) return;
        dealerState.current = s;
        await publishCommitments(db, roomId, "dealer", s.commitments);
      } else {
        const s = await generateSelectorCommitments(seed);
        if (cancelled) return;
        selectorState.current = s;
        await publishCommitments(db, roomId, "selector", s.commitments);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, roomId, gameNumber, role]);

  // Learn the opponent's (and echo of my own) commitments.
  useEffect(() => {
    if (!role) return;
    const offDealer = subscribeToCommitments(db, roomId, "dealer", (commitments) => {
      protocol.current = setCommitments(protocol.current, "dealer", commitments);
    });
    const offSelector = subscribeToCommitments(db, roomId, "selector", (commitments) => {
      protocol.current = setCommitments(protocol.current, "selector", commitments);
    });
    return () => {
      offDealer();
      offSelector();
    };
  }, [db, roomId, role]);

  // The selector eagerly reveals the position for the next draw index as
  // soon as both commitment sets are known (drawIndex 0 first). Advances
  // one at a time as `state.drawCount` grows.
  useEffect(() => {
    if (role !== "selector" || !selectorState.current) return;
    const drawIndex = state.drawCount;
    if (drawIndex >= 52 || publishedPosition.current.has(drawIndex)) return;
    if (!protocol.current.dealerCommitments || !protocol.current.selectorCommitments) return;
    publishedPosition.current.add(drawIndex);
    const { position, salt } = revealDraw(drawIndex, selectorState.current);
    void publishReveal(db, roomId, {
      kind: "position",
      by: you,
      drawIndex,
      position,
      saltHex: saltToHex(salt),
    });
  }, [db, roomId, you, role, state.drawCount]);

  // Handle every incoming protocol message: verify it, and if I'm the
  // dealer, answer a fresh position reveal with the matching card reveal
  // (opening deal only in this task — Task 6 adds the face-down skip).
  useEffect(() => {
    if (!role) return;
    return subscribeToReveals(db, roomId, (reveal: ProtocolReveal) => {
      void handleReveal(reveal);
    });

    async function handleReveal(reveal: ProtocolReveal) {
      if (reveal.kind === "position") {
        protocol.current = await applyPositionReveal(
          protocol.current,
          reveal.drawIndex,
          reveal.position,
          hexToSalt(reveal.saltHex),
        );
        if (role === "dealer" && dealerState.current && !publishedCard.current.has(reveal.position)) {
          publishedCard.current.add(reveal.position);
          const { card, salt } = revealCard(reveal.position, dealerState.current);
          await publishReveal(db, roomId, {
            kind: "card",
            by: you,
            position: reveal.position,
            cardId: cardId(card),
            saltHex: saltToHex(salt),
          });
        }
      } else if (reveal.kind === "card") {
        // cardId round-trips through Card via the dealer's own deck — the
        // dealer already holds the Card object; other clients reconstruct
        // it from the revealed identity once verified below.
      }
    }
  }, [db, roomy, role]); // placeholder — fixed in Step 3b below

  return { state, getEvents };
}
```

The sketch above has a gap (a `Card` can't be verified from just its
`cardId` string without the suit/rank back). Fix it before running the
test — Step 3b:

```ts
// src/engine/deck.ts already exports cardId(card) -> "Suit-Rank".
// Add the inverse next to it (small, engine-layer, no runtime deps):
export function cardFromId(id: string): Card {
  const [suit, rankStr] = id.split("-") as [Card["suit"], string];
  return { suit, rank: Number(rankStr) as Card["rank"] };
}
```

Then replace the `"card"` branch and fix the `db, roomy` typo:

```ts
      } else if (reveal.kind === "card") {
        const card = cardFromId(reveal.cardId);
        protocol.current = await applyCardReveal(
          protocol.current,
          reveal.position,
          card,
          hexToSalt(reveal.saltHex),
        );
      }
    }
  }, [db, roomId, you, role]);
```

And add the opening-deal assembly effect, driven by `resolvedDraw`:

```ts
  // Once a draw index in [0, 10) resolves, stash its card. Once all 10 are
  // in, dispatch one DEAL event — both clients compute this independently
  // from the same verified reveals, so no coordination is needed.
  useEffect(() => {
    if (!role || dealt.current) return;
    for (let i = 0; i < DEAL_SLOTS.length; i++) {
      if (dealBuffer.current.has(i)) continue;
      const card = resolvedDraw(protocol.current, i);
      if (card) dealBuffer.current.set(i, card);
    }
    if (dealBuffer.current.size < DEAL_SLOTS.length) return;
    dealt.current = true;
    const cards: Record<PlayerId, Card[]> = { p1: [], p2: [] };
    DEAL_SLOTS.forEach((slot, i) => {
      cards[slot.player][slot.hand] = dealBuffer.current.get(i)!;
    });
    dispatch({ type: "DEAL", cards });
    void publishTurnStarted(db, roomId);
  });
```

(This effect has no dependency array — it's cheap, idempotent past
`dealt.current`, and needs to re-check after every reveal without adding
`protocol.current` mutations as a dependency, mirroring how `useSoloGame`'s
`dealt` ref guard works.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:emulator:ui` (runs every *.emulator.test.ts under src/ui via the jsdom+emulator config added in Task 5 Step 0)
Expected: PASS. If the two `renderHook` instances don't converge within the
timeout, log `protocol.current.violations` from each to see which reveal
failed verification before debugging further.

- [ ] **Step 5: Commit**

```bash
git add vitest.emulator.jsdom.config.ts vitest.config.ts package.json src/engine/deck.ts src/engine/deck.test.ts src/ui/hooks/useMultiplayerGame.ts src/ui/hooks/useMultiplayerGame.emulator.test.ts
git commit -m "feat(ui): useMultiplayerGame — commit-reveal shuffle and opening deal

Also adds the jsdom+emulator vitest config/script this and later tasks'
hook tests need (renderHook requires jsdom+React; the commit-reveal flow
requires a real Firebase emulator; neither existing config had both)."
```

(Add a one-line `cardFromId` round-trip test to `src/engine/deck.test.ts`
alongside the existing `cardId` tests before this commit.)

---

### Task 5b: Engine — hidden placements and deferred scoring

**Why this task exists:** see the spec's 2026-09-24 amendment. The reducer
must be able to place a card the local player does not know (the dealer's
face-down cards, seen from the selector), and must not score until every
card is known. This is a deliberate, small relaxation of the plan's earlier
"engine untouched" constraint; solo behaviour must stay byte-for-byte the same.

**Files:**
- Modify: `src/engine/types.ts` (three new `GameEvent` variants)
- Modify: `src/engine/reducer.ts`
- Test: the existing reducer test file (find it with a glob for
  `src/engine/reducer*.test.ts`) — add cases there

**Interfaces (produces, consumed by Tasks 6-7):**
- `{ type: "PLACE_HIDDEN"; by: PlayerId; handIndex: number }` — like
  `DRAW` + `END_TURN` in one step for a card the local client does not
  know. Requires phase `placing`, `turn === by`, `pendingCard === null`,
  `handIndex` legal AND a face-down placement (`isFaceDownPlacement`).
  Places `{ faceUp: false }` (no `card`), `drawCount + 1`, then the same
  turn advance as `END_TURN`.
- `{ type: "REPLACE_HIDDEN"; by: PlayerId; handIndex: number | null }` —
  the replace-phase equivalent: `drawCount + 1`, marks `replaceDone[by]`,
  and when `handIndex !== null` overwrites that hand's 5th slot with
  `{ faceUp: false }` (no `card`); same turn/phase advance as `REPLACE`.
- `{ type: "REVEAL_FACE_DOWN"; cards: Record<PlayerId, Card[]> }` — index
  `i` is hand `i`'s face-down 5th card. Requires phase `reveal` and
  `result === null`. Fills every face-down slot that has no `card`, asserts
  every card in both players' hands is now known, then sets
  `result = scoreGame(hands)`.
- Deferred scoring: in `applyReplace`, compute `result` only if every
  placed card in both players' hands has a `card`; otherwise `result: null`.
  When all are known (always in solo) behaviour is unchanged.
- `applyAdvanceReveal` must assert `state.result !== null` (a hidden game
  cannot advance the animation before `REVEAL_FACE_DOWN` lands).

- [ ] **Step 1: Read first.** Read `reducer.ts`, `placement.ts`,
  `scoring.ts`, and `useRevealPacer.ts`, `RevealSequence.tsx`,
  `ResultOverlay.tsx`, `Board.tsx`. Write down (in your report) every place
  that assumes `state.result` is non-null once `phase === "reveal"`. Gate
  each such place on `result !== null` — `useRevealPacer` in particular must
  not dispatch `ADVANCE_REVEAL` while `result` is null.
- [ ] **Step 2: Write failing tests** (table-driven, in the reducer test
  file): `PLACE_HIDDEN` places a card-less face-down slot and advances the
  turn; rejects a non-face-down placement, a pending card, the wrong turn;
  `REPLACE_HIDDEN` with and without a swap; a full hidden game reaches
  `reveal` with `result === null`; `REVEAL_FACE_DOWN` fills the slots and
  the resulting `result` deep-equals what `scoreGame` gives for the same
  fully-known hands; `REVEAL_FACE_DOWN` rejects a missing card or a wrong
  phase; `ADVANCE_REVEAL` rejects while `result === null`; a solo-style game
  (all cards known) still scores in `applyReplace` exactly as before.
- [ ] **Step 3: Run to verify failure:** `pnpm test src/engine`
- [ ] **Step 4: Implement** the three cases, following `reducer.ts`'s
  existing style (`assert(...)`, spread-copy state, no mutation), plus the
  deferred-scoring and `ADVANCE_REVEAL` guard, plus the UI gating from Step 1.
- [ ] **Step 5: Run** `pnpm test` (whole suite), `pnpm exec tsc -b`,
  `pnpm lint`. All must pass; no solo test may change.
- [ ] **Step 6: Commit**

```bash
git add src/engine src/ui
git commit -m "feat(engine): hidden placements and deferred scoring for multiplayer face-down cards"
```

**Downstream amendments (controller will apply before dispatching):**
Task 6 — the selector dispatches `PLACE_HIDDEN` on the dealer's face-down
turn (the dealer still dispatches `DRAW` + `END_TURN`); Task 7 — `ProtocolReveal`'s
`placementReveal` becomes one batched message
`{ kind: "placementReveal"; by; cards: { handIndex; cardId; saltHex }[] }`,
sent once when the replace phase ends, and each client dispatches one
`REVEAL_FACE_DOWN` when both players' batches have verified; `ADVANCE_REVEAL`
is no longer published.

---

### Task 6: `useMultiplayerGame` — per-turn draw, place, replace, face-down skip

> **CONTROLLER AMENDMENT (2026-09-24, supersedes conflicting text below).**
> Task 5b added engine events `PLACE_HIDDEN`, `REPLACE_HIDDEN`,
> `REVEAL_FACE_DOWN` and deferred scoring. This task must use them. Read
> the CURRENT `useMultiplayerGame.ts` first (it has `updateProtocol`, a
> `protocolTick`, per-player seeds); the code sketches below predate it.
>
> 1. **Opponent event intake (missing from the original plan).** Mount ONE
>    `subscribeToEvents` effect for the game's lifetime. `onChildAdded`
>    also echoes your own writes: ignore events whose `by === you`. Events
>    without `by` (e.g. REMATCH) are handled by their own tasks. For an
>    opponent `END_TURN {handIndex, faceDown}`: 
>    - if I am the SELECTOR, the opponent is the dealer, and `faceDown` is
>      true: dispatch `PLACE_HIDDEN { by: opponent, handIndex }` (I never
>      learn that card until the reveal phase);
>    - otherwise wait until my local `state.pendingCard` for that turn has
>      been resolved via the reveal chain (the event may arrive BEFORE the
>      card reveal verifies), then dispatch the `END_TURN` unchanged.
>    Keep unprocessed opponent events in a ref-backed FIFO queue that is
>    re-checked after every render/tick, so a fast END_TURN never gets
>    dropped or applied out of order.
> 2. **Dealer's own face-down turn.** The dealer never publishes a `card`
>    reveal for it (already in the plan below), so `resolvedDraw` never
>    resolves that index. The dealer's client must dispatch `DRAW` itself
>    using `dealerState.current.deck[protocol.current.positions[drawIndex]]`
>    once the selector's position reveal for that index has verified. Do
>    this as a fallback inside the per-turn DRAW effect (`role === "dealer"`
>    and `resolvedDraw` is null but the position is known). Its own
>    `END_TURN` is then dispatched by `placePending` as planned.
> 3. **The selector's own face-down turn is normal**: both cards reveal,
>    the dealer learns it (the accepted asymmetry); the dealer's client
>    applies the selector's `END_TURN` via rule 1's second branch.
> 4. The test must end with hands that are equal on both clients EXCEPT
>    the dealer's face-down `card` fields on the selector's client: assert
>    equality of `drawCount`, `turn`, `phase`, face-up cards and
>    `faceUp` flags, and that the selector's view of the dealer's 5th-card
>    slots has no `card` while the dealer's own view does.
> 5. TIMEOUT on hidden turns is NOT in this task (open item, owned by the
>    timer task); leave `timeout()` a documented no-op as planned.

**Files:**
- Modify: `src/ui/hooks/useMultiplayerGame.ts`
- Test: `src/ui/hooks/useMultiplayerGame.emulator.test.ts` (extend)

**Interfaces:**
- Consumes: `getLegalHands`, `isFaceDownPlacement` (`engine/placement.ts`).
- Produces: the hook's return type grows to match `SoloGame`
  (`src/ui/hooks/useSoloGame.ts`'s exported type) minus `aiThinking`
  (always `false` in multiplayer — no AI):
  `{ state, getEvents, you, legalHands, canDraw, isHumanTurn, aiThinking: false, draw, placePending, replaceDraw, replace, timeout, playAgain }`
  so `GameScreen` (Task-8-onward wiring) can treat both hooks the same way.
- Design decisions locked in here:
  - Draw indices `10..49` are per-turn placing draws (40 cards, one per
    `DRAW`), `50..51` are the two replace-phase draws.
  - **Correction to how Task 5 actually shipped:** Task 5's implementer
    found that gating the opening deal's position reveals on
    `state.drawCount` deadlocks (drawCount stays 0 until DEAL fires, which
    itself waits on those reveals) — so Task 5's selector effect instead
    reveals all of indices `0..9` eagerly, in one pass, and stops there. It
    does **not** extend to indices `10..51`. This task must add its own,
    separate effect for that (Step 3 below includes it) — do not assume
    Task 5's effect already covers per-turn draws.
  - Task 5 also introduced two helpers this task must keep using, not
    bypass: `setProtocol(next)` (a thin wrapper that both writes
    `protocol.current` and bumps a `protocolTick` state counter, since a
    bare ref mutation never triggers React to re-run effects that read
    `protocol.current`) and `revealQueue` (a ref holding a promise chain
    that serializes every incoming reveal's async verification, since two
    reveals verifying concurrently can race and silently drop one
    other's update to `protocol.current`). Read the actual current
    contents of `useMultiplayerGame.ts` before writing this task's code —
    it has already evolved past the plan's original Task 5 sketch in ways
    that matter here.
  - **Face-down dealer skip:** when it's the dealer's turn and the pending
    card would land face-down (`isFaceDownPlacement`), the dealer's
    `placePending`/`replace` publishes a `"placementCommit"` message
    instead of letting the opponent see the resolved card, and dispatches
    `END_TURN`/`REPLACE` using the card it already knows locally (from
    `dealerState.current`, not from a `"card"` reveal — the dealer never
    needs the selector to publish that reveal for its own face-down turn,
    so the dealer-side handler for `"position"` reveals must skip
    publishing a `"card"` reveal in that one case).

- [ ] **Step 1: Write the failing test**

```ts
// append to src/ui/hooks/useMultiplayerGame.emulator.test.ts
test("a full placing phase converges to matching hands on both clients", async () => {
  await publishDealer(db, roomId, "p1");

  const p1 = renderHook(() => useMultiplayerGame({ db, roomId, you: "p1", gameNumber: 1 }));
  const p2 = renderHook(() => useMultiplayerGame({ db, roomId, you: "p2", gameNumber: 1 }));

  await waitFor(() => expect(p1.result.current.state.phase).toBe("placing"), { timeout: 5000 });

  // Drive both clients through the placing phase: whoever's turn it is
  // draws, then places on the first legal hand.
  for (let guard = 0; guard < 60; guard++) {
    const active = p1.result.current.state.turn === "p1" ? p1 : p2;
    if (active.result.current.state.phase !== "placing") break;
    if (active.result.current.canDraw) {
      await act(async () => active.result.current.draw());
      await waitFor(() => expect(active.result.current.state.pendingCard).not.toBeNull());
    } else if (active.result.current.state.pendingCard) {
      const hand = active.result.current.legalHands[0];
      await act(async () => active.result.current.placePending(hand));
    }
    await waitFor(() => {}, { timeout: 50 }).catch(() => {});
  }

  await waitFor(() => expect(p1.result.current.state.phase).toBe("replace"), { timeout: 10000 });
  expect(p1.result.current.state.hands).toEqual(p2.result.current.state.hands);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:emulator:ui` (runs every *.emulator.test.ts under src/ui via the jsdom+emulator config added in Task 5 Step 0)
Expected: FAIL — `draw`/`placePending`/etc. aren't returned yet.

- [ ] **Step 3: Implement**

Add local intent functions and the face-down skip, and widen the return
value:

```ts
// add near the top of useMultiplayerGame.ts's imports
import { getLegalHands, isFaceDownPlacement } from "../../engine/placement";

// inside useMultiplayerGame, after the existing effects:
  const isHumanTurn =
    state.turn === you && (state.phase === "placing" || state.phase === "replace");
  const legalHands = isHumanTurn
    ? state.phase === "replace"
      ? [] // replace-phase legality for multiplayer arrives in a later task
      : getLegalHands(state.hands[you])
    : [];
  // Always false: multiplayer draws are not a button press. Unlike solo,
  // where draw() pulls the next card from a locally-held shuffled deck,
  // neither multiplayer client holds a deck — the card can only become
  // known once the verified reveal chain resolves it (see the effect
  // below), which happens automatically the moment it's this player's
  // turn. Surfacing `canDraw: true` here would render a "Draw" button
  // that does nothing when clicked, since draw() has nothing to publish.
  const canDraw = false;

  // Inert: kept only so this hook satisfies the same GameHandle shape as
  // useSoloGame. Never user-invocable (canDraw is always false above), so
  // GameScreen never renders a control that would call these.
  function draw() {}
  function replaceDraw() {}

  async function placePending(handIndex: number) {
    if (state.phase !== "placing" || state.turn !== you || !state.pendingCard) return;
    const faceDown = isFaceDownPlacement(state.hands[you][handIndex]);
    if (role === "dealer" && faceDown) {
      const salt = generateSalt();
      const commitment = await commitPlacement(state.pendingCard, handIndex, salt);
      pendingPlacementSalts.current.set(handIndex, salt);
      await publishReveal(db, roomId, {
        kind: "placementCommit",
        by: you,
        handIndex,
        commitment,
      });
    }
    dispatch({ type: "END_TURN", by: you, handIndex, faceDown });
    await publishEndTurn(db, roomId, { type: "END_TURN", by: you, handIndex, faceDown }, otherPlayer(you));
    await publishTurnStarted(db, roomId);
  }

  function replace(_handIndex: number | null) {
    /* wired in Task 7 alongside the replace-phase reveal flow */
  }

  function timeout() {
    /* wired in Task 8 alongside the remote turn timer */
  }

  function playAgain() {
    /* wired in Task 11 */
  }

  // The load-bearing counterpart to Task 5's opening-deal buffer: every
  // draw index from 10 onward (per-turn placing draws, then the two
  // replace-phase draws at 50/51) resolves into a DRAW or REPLACE_DRAW the
  // instant its reveal verifies — nothing else advances state.drawCount
  // once the opening deal is done, so without this effect the game stalls
  // forever after DEAL. No dependency array, same reasoning as the DEAL
  // effect: it's cheap, and it must re-check after every reveal without
  // needing protocol.current (a ref) as a tracked dependency. Both clients
  // resolve and dispatch this identically and independently, exactly like
  // DEAL — no coordination message needed.
  useEffect(() => {
    if (!role) return;
    if (state.phase !== "placing" && state.phase !== "replace") return;
    if (state.pendingCard !== null) return; // already have this turn's card
    const drawIndex = state.drawCount;
    if (drawIndex < DEAL_SLOTS.length) return; // opening deal, handled separately
    const card = resolvedDraw(protocol.current, drawIndex);
    if (!card) return;
    if (state.phase === "placing") {
      dispatch({ type: "DRAW", by: state.turn, card });
    } else {
      dispatch({ type: "REPLACE_DRAW", by: state.turn, card });
    }
  });

  return {
    state,
    getEvents,
    you,
    legalHands,
    canDraw,
    isHumanTurn,
    aiThinking: false as const,
    draw,
    placePending,
    replaceDraw,
    replace,
    timeout,
    playAgain,
  };
```

Add the two small helpers this uses — `commitPlacement` in
`protocolController.ts` (pure hashing, so it belongs there, not inline in
the hook) and `publishEndTurn` as a thin re-export of the already-existing
`publishEvent` (`net/sync.ts`) so the hook doesn't import two names for the
same thing:

```ts
// add to src/crypto/protocolController.ts
import { commit } from "./commitment";
import { cardId } from "../engine/deck";
// (Card, already imported)

/** Hash for a dealer's secret face-down placement: H(cardId || handIndex || salt). */
export function commitPlacement(card: Card, handIndex: number, salt: Uint8Array): Promise<string> {
  return commit(`${cardId(card)}:${handIndex}`, salt);
}
```

```ts
// in useMultiplayerGame.ts, alias the existing publisher instead of a new one
import { publishEvent as publishEndTurn } from "../../net/sync";
```

Also track pending placement salts (needed by the reveal phase in Task 7):

```ts
  const pendingPlacementSalts = useRef<Map<number, Uint8Array>>(new Map());
```

**New effect this task adds** — the selector's per-turn position reveal.
Task 5's eager-reveal effect only covers `drawIndex 0..9`; this is the
`10..51` counterpart, gated on `state.drawCount` (safe here — unlike the
opening deal, each of these indices only becomes "next" once the previous
`DRAW`/`REPLACE_DRAW` has actually dispatched and bumped `drawCount`, so
there's no equivalent deadlock):

```ts
  useEffect(() => {
    if (role !== "selector" || !selectorState.current) return;
    const drawIndex = state.drawCount;
    if (drawIndex < DEAL_SLOTS.length || drawIndex >= 52) return;
    if (publishedPosition.current.has(drawIndex)) return;
    publishedPosition.current.add(drawIndex);
    const { position, salt } = revealDraw(drawIndex, selectorState.current);
    void publishReveal(db, roomId, {
      kind: "position",
      by: you,
      drawIndex,
      position,
      saltHex: saltToHex(salt),
    });
  }, [db, roomId, you, role, state.drawCount]);
```

And extend the reveal handler's `"position"` branch from Task 5 — read the
actual current `handleReveal` function in `useMultiplayerGame.ts` first,
since it verifies via `setProtocol(await applyPositionReveal(...))` inside
a `revealQueue`-serialized handler, not the plan's original raw sketch.
Add the face-down skip as an extra condition on the existing "answer with
a card reveal" branch, keeping everything else (the `setProtocol` call
above it, the `revealQueue` wrapping) exactly as Task 5 left it:

```ts
        if (
          role === "dealer" &&
          dealerState.current &&
          !publishedCard.current.has(reveal.position) &&
          !isMyFaceDownTurn(reveal.drawIndex)
        ) {
          // ...unchanged: publishedCard.current.add(...), revealCard(...),
          // await publishReveal(...) — only the condition above is new.
        }
```

```ts
  // True when this position reveal is for the dealer's own turn AND that
  // turn's placement will land face-down (fill-evenly already full on every
  // other hand) — the one case where the dealer must NOT reveal the card.
  function isMyFaceDownTurn(drawIndex: number): boolean {
    if (drawIndex < DEAL_SLOTS.length) return false; // opening deal is always face-up
    return state.turn === you && state.phase === "placing" &&
      getLegalHands(state.hands[you]).every((h) => isFaceDownPlacement(state.hands[you][h]));
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:emulator:ui` (runs every *.emulator.test.ts under src/ui via the jsdom+emulator config added in Task 5 Step 0)
Expected: PASS (both tests). Debug via `protocol.current.violations` and
`getEvents()` diffs between `p1`/`p2` if the two clients diverge.

- [ ] **Step 5: Commit**

```bash
git add src/crypto/protocolController.ts src/crypto/protocolController.test.ts src/ui/hooks/useMultiplayerGame.ts src/ui/hooks/useMultiplayerGame.emulator.test.ts
git commit -m "feat(ui): useMultiplayerGame — per-turn draw/place loop with dealer face-down skip"
```

---

### Task 7: `useMultiplayerGame` — replace phase and reveal phase

> **CONTROLLER AMENDMENT (2026-09-24, supersedes conflicting text below).**
> Read the CURRENT `useMultiplayerGame.ts` first. Design changes:
> 1. **Batched reveal.** `ProtocolReveal`'s `placementReveal` in
>    `net/sync.ts` becomes ONE message per player:
>    `{ kind: "placementReveal"; by; cards: { handIndex: number; cardId: string; saltHex: string }[] }`
>    (update the type and add a sync emulator test for the round trip). Each
>    player publishes it ONCE, when the replace phase ends (state.phase
>    becomes `reveal`), containing every face-down card whose owner is that
>    player and which the OPPONENT does not yet know: for the dealer that is
>    all five of its own 5th cards; for the selector nothing is hidden from
>    the dealer, so its batch may be empty or omitted. Use the salts stored
>    in `pendingPlacementSalts` (Task 6) and verify the opponent's batch
>    against their `placementCommit` hashes with a new pure
>    `applyPlacementReveal` in `crypto/protocolController.ts`
>    (recompute `commitPlacement(card, handIndex, salt)`; mismatch is a
>    violation) — put it through `updateProtocol`.
> 2. **One dispatch.** When both required batches have verified, dispatch a
>    single `REVEAL_FACE_DOWN { cards }` (index i = hand i's 5th card, both
>    players). It is idempotent on a client that already knows everything.
>    Do NOT publish `ADVANCE_REVEAL`; `useRevealPacer` dispatches it locally
>    once `state.result` is non-null.
> 3. **Replace phase with hidden cards.** The dealer never publishes a
>    `card` reveal for its OWN replace draw (it may swap into a hidden
>    slot). When I am the selector and the dealer's `REPLACE` event arrives
>    (rule 1 of Task 6's intake), dispatch `REPLACE_HIDDEN { by, handIndex }`
>    instead of `REPLACE_DRAW`+`REPLACE`. The selector's own replace is
>    normal (the dealer learns the card). The dealer's per-turn DRAW
>    fallback (Task 6 rule 2) applies to `REPLACE_DRAW` too.
> 4. **Re-render trigger bug in the sketch below:** `revealedByThem` is a
>    ref mutated by one effect and read by another with no re-render. Use
>    the existing `protocolTick`/`updateProtocol` pattern (verified batches
>    live in protocol state, not a bare ref).
> 5. `hasViolation` from a failed placement verification must feed Task
>    15's violation screen; wire the field, Task 15 renders it.
> 6. **Replace-phase indices.** Replace draws are `50` (p1's turn, first) and
>    `51` (p2's). The dealer's own replace draw index is `50` if the dealer
>    is p1, else `51`. On that index the dealer publishes NO `card` reveal
>    (Task 6 currently reveals it normally — that is the leak to close);
>    derive this from the index/roles like Task 6's `isFaceDownDraw`, not
>    from stale `state`. The dealer's client dispatches `REPLACE_DRAW` for
>    it via the own-deck fallback, then `REPLACE` with the real card.
> 7. **Opponent-event intake must now also handle `REPLACE`** (Task 6's
>    queue blocks on any non-END_TURN event, with a one-time warning):
>    selector receiving the dealer's REPLACE → `REPLACE_HIDDEN { by,
>    handIndex }` (cross-check like Task 6 rule 3); dealer receiving the
>    selector's REPLACE → wait for its `REPLACE_DRAW` to resolve via the
>    normal reveal chain, then dispatch `REPLACE` unchanged. TIMEOUT stays
>    unhandled (open item, timer task) and must keep warning once.
> 8. **Hidden swap needs a new commitment.** When the dealer swaps its
>    replace-draw card into a hand's 5th slot, it publishes a NEW
>    `placementCommit` for that `handIndex` (fresh salt, new card;
>    latest commit per hand wins) and updates `pendingPlacementSalts`. The
>    controller's per-hand commit map must therefore keep the LATEST commit
>    per `handIndex`; `applyPlacementReveal` verifies against it. If the
>    dealer passes (`handIndex === null`) nothing is published.

**Files:**
- Modify: `src/ui/hooks/useMultiplayerGame.ts`
- Test: `src/ui/hooks/useMultiplayerGame.emulator.test.ts` (extend)

**Interfaces:**
- Produces: working `replace(handIndex)`, and a reveal-phase driver that
  publishes `"placementReveal"` for every face-down card this player owns
  once `state.phase === "reveal"`, verifies the opponent's, and dispatches
  `ADVANCE_REVEAL` once both sides of a matchup have revealed (or were
  always face-up).

- [ ] **Step 1: Write the failing test**

```ts
// append to src/ui/hooks/useMultiplayerGame.emulator.test.ts
test("replace phase and reveal phase converge to a result on both clients", async () => {
  await publishDealer(db, roomId, "p1");
  const p1 = renderHook(() => useMultiplayerGame({ db, roomId, you: "p1", gameNumber: 1 }));
  const p2 = renderHook(() => useMultiplayerGame({ db, roomId, you: "p2", gameNumber: 1 }));

  await waitFor(() => expect(p1.result.current.state.phase).toBe("placing"), { timeout: 5000 });
  for (let guard = 0; guard < 60; guard++) {
    const active = p1.result.current.state.turn === "p1" ? p1 : p2;
    if (active.result.current.state.phase !== "placing") break;
    if (active.result.current.canDraw) await act(async () => active.result.current.draw());
    else if (active.result.current.state.pendingCard) {
      await act(async () => active.result.current.placePending(active.result.current.legalHands[0]));
    }
  }
  await waitFor(() => expect(p1.result.current.state.phase).toBe("replace"), { timeout: 10000 });

  for (const hook of [p1, p2]) {
    await act(async () => hook.result.current.draw());
    await waitFor(() => expect(hook.result.current.state.pendingCard).not.toBeNull());
    await act(async () => hook.result.current.replace(null));
  }

  await waitFor(() => expect(p1.result.current.state.phase).toBe("reveal"), { timeout: 10000 });
  for (let guard = 0; guard < 10 && p1.result.current.state.phase === "reveal"; guard++) {
    await waitFor(() => {}, { timeout: 200 }).catch(() => {});
  }
  await waitFor(() => expect(p1.result.current.state.phase).toBe("result"), { timeout: 10000 });
  expect(p1.result.current.state.result).toEqual(p2.result.current.state.result);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:emulator:ui` (runs every *.emulator.test.ts under src/ui via the jsdom+emulator config added in Task 5 Step 0)
Expected: FAIL — `replace` is still a no-op, reveal phase never advances.

- [ ] **Step 3: Implement**

```ts
  async function replace(handIndex: number | null) {
    if (state.phase !== "replace" || state.turn !== you || !state.pendingCard) return;
    dispatch({ type: "REPLACE", by: you, handIndex });
    await publishEndTurn(db, roomId, { type: "REPLACE", by: you, handIndex }, otherPlayer(you));
    if (state.phase !== "reveal") await publishTurnStarted(db, roomId);
  }
```

`draw`/`replaceDraw` stay the no-ops from Task 6 — the selector's
eager-reveal effect already covers `drawCount` 50 and 51 (the replace-phase
draws) with no change needed, since it's keyed purely off `state.drawCount`
regardless of phase.

Add the reveal-phase driver as a new effect:

```ts
  // Reveal phase: publish the true card + salt for every face-down card I
  // own, verify the opponent's, and advance one matchup at a time once
  // both sides of it are settled (a hand with no face-down card needs no
  // reveal at all).
  const revealedByMe = useRef<Set<number>>(new Set());
  const revealedByThem = useRef<Map<number, Card>>(new Map());

  useEffect(() => {
    if (state.phase !== "reveal") return;
    const handIndex = state.revealIndex;
    if (handIndex >= HANDS_PER_PLAYER) return;

    const mine = state.hands[you][handIndex].cards[4];
    if (mine && !mine.faceUp && mine.card && !revealedByMe.current.has(handIndex)) {
      revealedByMe.current.add(handIndex);
      const salt = pendingPlacementSalts.current.get(handIndex) ?? generateSalt();
      void publishReveal(db, roomId, {
        kind: "placementReveal",
        by: you,
        handIndex,
        cardId: cardId(mine.card),
        saltHex: saltToHex(salt),
      });
    }

    const opponent = otherPlayer(you);
    const theirs = state.hands[opponent][handIndex].cards[4];
    const needTheirs = theirs && !theirs.faceUp;
    const haveTheirs = !needTheirs || revealedByThem.current.has(handIndex);
    const haveMine = !mine || mine.faceUp || revealedByMe.current.has(handIndex);

    if (haveMine && haveTheirs) {
      dispatch({ type: "ADVANCE_REVEAL" });
      if (you === "p1") void publishEndTurn(db, roomId, { type: "ADVANCE_REVEAL" });
    }
  }, [db, roomId, you, state.phase, state.revealIndex, state.hands]);

  useEffect(() => {
    if (state.phase !== "reveal") return;
    return subscribeToReveals(db, roomId, (reveal) => {
      if (reveal.kind !== "placementReveal" || reveal.by === you) return;
      revealedByThem.current.set(reveal.handIndex, cardFromId(reveal.cardId));
      // The reducer needs the real card in state before scoring reads it —
      // route it back in as a same-shaped ADVANCE_REVEAL precondition by
      // re-dispatching the owning player's END_TURN/REPLACE isn't valid
      // post-hoc, so face-down cards are compared for scoring purposes via
      // the already-placed PlacedCard.card the owner set locally at
      // placement time (dealer) or draw time (selector, whose face-down
      // cards were never hidden from the dealer to begin with) — this
      // subscription exists to verify the opponent's reveal, not to mutate
      // state. Verification-only for now; hookup to protocolController
      // happens in Task 15 (protocol violation handling) — see that
      // task's note on placementReveal verification not yet feeding
      // hasViolation().
    });
  }, [db, roomId, you, state.phase]);
```

Note in the plan for the implementer: the comment above is intentionally
explicit that **scoring already has the real cards** — `scoreGame` runs
inside `applyReplace` in the reducer the moment both players finish the
replace phase (see `reducer.ts:236`), using each `PlacedCard.card`, which
every client already set locally when it placed or replaced that card. The
reveal phase's publish/subscribe here is the **anti-cheat check**, not a
data dependency — Task 14 wires actual violation detection into it. Keep
this task's scope to making the phase visually advance and reach `result`
with matching state on both clients, which the test above verifies.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:emulator:ui` (runs every *.emulator.test.ts under src/ui via the jsdom+emulator config added in Task 5 Step 0)
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/ui/hooks/useMultiplayerGame.ts src/ui/hooks/useMultiplayerGame.emulator.test.ts
git commit -m "feat(ui): useMultiplayerGame — replace phase and reveal-phase verification"
```

---

### Task 7b: Engine — TIMEOUT_HIDDEN

**Why this task exists:** `TIMEOUT { by, card }` requires a `Card`, but per
spec ("TIMEOUT: only the non-active player can write") the opponent
detects and reports a timeout, not the player who timed out. On the
dealer's own face-down turn, the opponent (selector) is exactly the client
that does NOT know the card, and — unlike a normal turn — a hidden turn
never populates `pendingCard` on the opponent's side at all (PLACE_HIDDEN
collapses draw+place into one card-less event, so there is nothing for
`TIMEOUT`'s "reuse the already-pending card" branch to fall back on
either). A card-less sibling event is needed, mirroring `PLACE_HIDDEN`.

**Files:**
- Modify: `src/engine/types.ts` (one new `GameEvent` variant)
- Modify: `src/engine/reducer.ts`
- Test: the reducer test file used by Task 5b

**Interfaces (produces, consumed by Task 8):**
- `{ type: "TIMEOUT_HIDDEN"; by: PlayerId }` — same preconditions as
  `TIMEOUT` (`phase === "placing"`, `turn === by`), no `card`/`handIndex`
  parameter. Auto-places via the existing `getAutoPlaceIndex(hands[by])`
  (deterministic from hand shapes both clients already see identically,
  so no coordination is needed — same reasoning as `PLACE_HIDDEN`'s
  determinism). Adds a strike; `drawCount: state.drawCount + 1`
  unconditionally (a hidden turn never separately drew — same as
  `PLACE_HIDDEN`). Reaching `MAX_STRIKES` forfeits exactly like `TIMEOUT`
  does today (share the forfeit branch, don't duplicate it).

- [ ] **Step 1: Write failing tests** (table-driven, same file as Task 5b):
  auto-places on the lowest-index legal hand as `{ faceUp: false }` (no
  `card`); adds a strike; forfeits at `MAX_STRIKES` with the same
  `GameResult` shape `applyTimeout` produces; rejects wrong phase/turn.
- [ ] **Step 2: Run to verify failure:** `pnpm test src/engine`
- [ ] **Step 3: Implement**, sharing the forfeit branch with `applyTimeout`
  (extract a small helper if that's cleaner than duplicating it).
- [ ] **Step 4:** `pnpm test`, `pnpm exec tsc -b`, `pnpm lint` — all green,
  no existing test changed.
- [ ] **Step 5: Commit**

```bash
git add src/engine
git commit -m "feat(engine): TIMEOUT_HIDDEN for a timed-out turn neither client can see"
```

---

### Task 8: Remote turn timer

> **CONTROLLER AMENDMENT (2026-09-25, supersedes conflicting text below).**
> Task 7b added `TIMEOUT_HIDDEN { by }` (engine-only; no wiring). This task
> wires BOTH `timeout()` variants into `useMultiplayerGame.ts` and finally
> closes the intake queue's TIMEOUT gap (Task 6/7 left it warn-once/no-op).
> Read the CURRENT `useMultiplayerGame.ts` first (it has `updateProtocol`,
> the opponent-event intake FIFO with `isFaceDownDraw`/`isFaceDownPlacement`
> cross-checks, `ownSecretDraw`, `warnOnce`).
>
> 1. **Who may write TIMEOUT.** Per spec, only the NON-active player writes
>    it (the player whose turn it is does not self-report). So `timeout()`
>    on this hook only ever does something when `!isHumanTurn &&
>    state.turn === <opponent>` — i.e. it's called when the LOCAL player's
>    remote timer (driven by `useRemoteTimer`, wired in `GameScreen` —
>    that wiring is Task 9, not this task) expires while it's the
>    OPPONENT's turn. This task only builds `timeout()`'s logic and a unit/
>    emulator-testable trigger for it; do not add the `GameScreen` timer
>    UI here (Task 9's job) — call `timeout()` directly from the test.
> 2. **Known-card case** (opponent's own turn is not a face-down turn, or
>    it's the selector's face-down turn where the dealer already knows the
>    card): if the opponent's card has already resolved into MY local
>    `state.pendingCard` (or I otherwise know it — the selector always
>    knows the dealer's non-face-down cards and its own), dispatch
>    `TIMEOUT { by: opponent, card }` locally and publish it via
>    `publishEndTurn`, same pattern as `placePending`. If the card has NOT
>    resolved yet (I don't have it), there is nothing to publish yet —
>    `useRemoteTimer` in Task 9 should keep the countdown at 0 rather than
>    calling `timeout()` in a tight loop; this hook's `timeout()` should be
>    a safe no-op when called with no usable card (do not throw).
> 3. **Hidden-card case** (my opponent is the dealer, on the dealer's own
>    face-down turn, and I am the selector — the one case where I can
>    NEVER learn the card before it's placed): dispatch `TIMEOUT_HIDDEN {
>    by: opponent }` locally and publish it via `publishEndTurn`.
>    Use the SAME `isFaceDownDraw`-based derivation Task 6 already built
>    to decide which case applies — do not add a second way to compute
>    this.
> 4. **Intake queue.** Replace the TIMEOUT/TIMEOUT_HIDDEN "warn and block"
>    behavior: an opposing `TIMEOUT` event (I am the dealer receiving the
>    selector's report of MY timeout, or vice versa) is applied directly —
>    it always carries a card the sender legitimately had. An opposing
>    `TIMEOUT_HIDDEN` is applied directly with no cross-check needed
>    beyond `by === state.turn` (the sender cannot have fabricated a card;
>    there isn't one). Remove these two event types from the "blocks the
>    queue" warn-once path; they should have been handled since Task 6/7
>    but a real trigger for testing them didn't exist until now.
> 5. **Strike indicator data is unaffected** (Task 10 reads `state.strikes`
>    regardless of which TIMEOUT variant produced it) — no change needed
>    there when this task lands.

**Files:**
- Create: `src/ui/hooks/useRemoteTimer.ts`
- Test: `src/ui/hooks/useRemoteTimer.test.ts`
- Modify: `src/ui/screens/GameScreen.tsx` (Task 8 only wires the hook in
  for the multiplayer branch added in Task 9's screen-selection change —
  if that hasn't landed yet, leave `GameScreen.tsx` untouched here and
  wire both together in Task 9)

**Interfaces:**
- Consumes: `subscribeToTurnStarted` (`net/roomState.ts`),
  `TURN_TIMEOUT_MS` (`engine/constants.ts`).
- Produces: `useRemoteTimer(db, roomId, active: boolean, onExpire: () => void): number`
  — seconds left, computed from the server's `turnStartedAt` rather than a
  local `Date.now()` start (so both clients agree even after a refresh).

- [ ] **Step 1: Write the failing test**

```ts
// src/ui/hooks/useRemoteTimer.test.ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { useRemoteTimer } from "./useRemoteTimer";

vi.mock("../../net/roomState", () => ({
  subscribeToTurnStarted: (
    _db: unknown,
    _roomId: string,
    callback: (at: number) => void,
  ) => {
    callback(Date.now() - 5_000); // turn started 5s ago
    return () => {};
  },
}));

describe("useRemoteTimer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("counts down from the remaining time, not the full duration", () => {
    const { result } = renderHook(() =>
      useRemoteTimer({} as never, "room", true, 60_000, () => {}),
    );
    expect(result.current).toBeLessThanOrEqual(55);
    expect(result.current).toBeGreaterThan(0);
  });

  test("calls onExpire once when the remaining time reaches 0", () => {
    const onExpire = vi.fn();
    renderHook(() => useRemoteTimer({} as never, "room", true, 1_000, onExpire));
    act(() => vi.advanceTimersByTime(1_500));
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/ui/hooks/useRemoteTimer.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```ts
// src/ui/hooks/useRemoteTimer.ts
import { useEffect, useRef, useState } from "react";
import type { Database } from "firebase/database";
import { subscribeToTurnStarted } from "../../net/roomState";

const TICK_MS = 200;

/**
 * Like {@link ./useTimer.ts}'s local countdown, but anchored to the room's
 * server-timestamped `turnStartedAt` instead of the moment this hook
 * mounted — so a page refresh mid-turn resumes the same countdown instead
 * of granting a fresh 60s.
 */
export function useRemoteTimer(
  db: Database,
  roomId: string,
  active: boolean,
  durationMs: number,
  onExpire: () => void,
): number {
  const [msLeft, setMsLeft] = useState(durationMs);
  const startedAt = useRef<number | null>(null);
  const onExpireRef = useRef(onExpire);
  const firedRef = useRef(false);
  useEffect(() => {
    onExpireRef.current = onExpire;
  });

  useEffect(() => {
    if (!active) return;
    return subscribeToTurnStarted(db, roomId, (at) => {
      startedAt.current = at;
    });
  }, [db, roomId, active]);

  useEffect(() => {
    if (!active) {
      firedRef.current = false;
      return;
    }
    const tick = () => {
      if (startedAt.current === null) return;
      const left = Math.max(0, durationMs - (Date.now() - startedAt.current));
      setMsLeft(left);
      if (left <= 0 && !firedRef.current) {
        firedRef.current = true;
        onExpireRef.current();
      }
    };
    const intervalId = setInterval(tick, TICK_MS);
    tick();
    return () => clearInterval(intervalId);
  }, [active, durationMs]);

  return Math.ceil((active ? msLeft : durationMs) / 1000);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/ui/hooks/useRemoteTimer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/hooks/useRemoteTimer.ts src/ui/hooks/useRemoteTimer.test.ts
git commit -m "feat(ui): useRemoteTimer — server-anchored turn countdown"
```

---

### Task 9: Wire `GameScreen` to pick solo vs. multiplayer by route

> **CONTROLLER AMENDMENT (2026-09-28, supersedes the "extract GameHandle"
> framing below).** By the time this task is reached, `useMultiplayerGame.ts`
> already defines `export type MultiplayerGame = Omit<SoloGame, "aiThinking"> &
> { aiThinking: false; hasViolation: boolean }` — it derives its shape FROM
> `SoloGame` directly rather than both hooks conforming to a separate
> `GameHandle` file. This already achieves the original goal (a field renamed
> on `SoloGame` breaks `useMultiplayerGame`'s type immediately) without a
> third file. **Do not create `src/ui/hooks/gameHandle.ts` or touch
> `SoloGame`'s type.** `timeout()` is also already fully implemented (Task 8,
> including hidden-turn handling and a bounded retry) — do not touch its
> logic. This task's real remaining scope is just the three items below.

**Files:**
- Modify: `src/ui/screens/GameScreen.tsx`
- Modify: `src/ui/hooks/useLobby.ts` (two lines — persist `you` across navigation)
- Test: `src/ui/screens/GameScreen.test.tsx` (new — the existing screen had
  none; add one covering the route branch)

**Interfaces:**
- Consumes: `useParams` (`react-router-dom`, already used by
  `LobbyScreen.tsx`), `useFirebaseClient` (`app/firebaseContext.ts`),
  `useRemoteTimer` (Task 8 — signature confirmed:
  `useRemoteTimer(db, roomId, active, durationMs, onExpire): number`),
  `useMultiplayerGame` (Tasks 5-8 — signature confirmed:
  `useMultiplayerGame({ db, roomId, you, gameNumber }): MultiplayerGame`).
- Produces: `GameScreen` renders `useSoloGame()` on `/solo`,
  `useMultiplayerGame(...)` on `/room/:roomId` (reading `you`/`gameNumber`
  from `sessionStorage`, written by `useLobby` — see below).

**Note on `you`/`gameNumber` plumbing:** `useLobby` currently keeps `you`
only in React state, lost on navigation to `/room/:roomId`. Add two lines
to `useLobby.ts`'s `create`/`join` (right after `setYou(...)`) to also
write `sessionStorage.setItem("duelPoker-you-" + id, "p1")` / `"p2"`
(mirrors the existing `duelPoker-{roomId}:{gameNumber}:{player}` key shape
from `seedStorage.ts`), and have `GameScreen` read it back. `gameNumber`
starts at `1` here and is driven by RTDB's `/rooms/{roomId}/gameNumber`
starting in Task 12 (rematch) — hardcode `1` in this task.

- [ ] **Step 1: Write the failing test**

```tsx
// src/ui/screens/GameScreen.test.tsx
import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GameScreen } from "./GameScreen";

const handle = {
  state: { phase: "placing", pendingCard: null, hands: { p1: [], p2: [] }, strikes: { p1: 0, p2: 0 } },
  you: "p1",
  legalHands: [],
  canDraw: false,
  isHumanTurn: false,
  aiThinking: false,
  draw: vi.fn(),
  placePending: vi.fn(),
  replaceDraw: vi.fn(),
  replace: vi.fn(),
  timeout: vi.fn(),
  playAgain: vi.fn(),
};

vi.mock("../hooks/useSoloGame", () => ({ useSoloGame: () => handle }));
vi.mock("../hooks/useMultiplayerGame", () => ({
  useMultiplayerGame: () => ({ ...handle, you: "p2", hasViolation: false }),
}));

vi.mock("../../app/firebaseContext", () => ({
  useFirebaseClient: () => ({ client: { db: {} }, uid: "test-uid" }),
}));

describe("GameScreen route selection", () => {
  test("renders without crashing on /solo", () => {
    render(
      <MemoryRouter initialEntries={["/solo"]}>
        <Routes>
          <Route path="/solo" element={<GameScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("game-screen")).toBeInTheDocument();
  });

  test("renders without crashing on /room/:roomId", () => {
    sessionStorage.setItem("duelPoker-you-ABC123", "p2");
    render(
      <MemoryRouter initialEntries={["/room/ABC123"]}>
        <Routes>
          <Route path="/room/:roomId" element={<GameScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("game-screen")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/ui/screens/GameScreen.test.tsx`
Expected: FAIL — no `data-testid="game-screen"`, no route branching yet.

- [ ] **Step 3: Implement**

```tsx
// src/ui/screens/GameScreen.tsx — replace the top of the component
import { useParams } from "react-router-dom";
import { useFirebaseClient } from "../../app/firebaseContext";
import { useMultiplayerGame } from "../hooks/useMultiplayerGame";
// ...existing imports stay...

function readYou(roomId: string): "p1" | "p2" {
  return (sessionStorage.getItem(`duelPoker-you-${roomId}`) as "p1" | "p2" | null) ?? "p1";
}

export function GameScreen() {
  const { roomId } = useParams();
  const { client } = useFirebaseClient();
  const solo = useSoloGame();
  const multiplayer = useMultiplayerGame({
    db: client.db,
    roomId: roomId ?? "",
    you: roomId ? readYou(roomId) : "p1",
    gameNumber: 1,
  });
  // Both hooks always run (hooks can't be called conditionally); only one
  // result is used. `useMultiplayerGame` no-ops its Firebase subscriptions
  // when `roomId` is empty (`role` never resolves for an empty room id, and
  // every effect guards on `role`).
  const g = roomId ? multiplayer : solo;

  // ...rest of the function body is unchanged, except the outer wrapper:
  return (
    <DndContext /* unchanged props */>
      <div className={styles.screen} data-testid="game-screen">
        {/* unchanged JSX using `g` and `state` as before */}
      </div>
    </DndContext>
  );
}
```

> **CONTROLLER RULING (2026-09-28), replacing the wiring sketch this
> amendment originally had here.** An implementer correctly stopped and
> reported NEEDS_CONTEXT on the sketch that used to be here: it gated
> `useRemoteTimer`'s `active`/`onExpire` on `isHumanTurn`, but `timeout()`
> is guaranteed to no-op on my own turn (only the non-active player may
> report a timeout — see Task 8). Under that wiring, an opponent's timeout
> would NEVER be detected. The fix needs TWO `useRemoteTimer` instances:
> one for the on-screen countdown during MY turn (as before, `onExpire` is
> harmless there since `timeout()` self-guards), and a second, silent one
> that watches the OPPONENT's turn and is the one that actually triggers a
> report. The second instance's returned `number` is unused — it's called
> for its `onExpire` side effect only. Gate the second instance on
> `!isHumanTurn && phase === "placing"` with no `pendingCard` requirement:
> the 60s deadline covers the whole turn from `turnStartedAt`, not just
> the post-draw window (multiplayer's `canDraw` is always false — the
> card auto-resolves near-instantly once the turn starts, so this mirrors
> solo's UX closely enough without needing to replicate the exact gate).

Wire `useRemoteTimer` into `GameScreen` for the multiplayer branch,
alongside the existing `useTimer` call (all three timer hooks are cheap
no-ops when their `active` argument is false, so calling them
unconditionally is safe and keeps hook-call order stable across renders):

```tsx
import { useRemoteTimer } from "../hooks/useRemoteTimer";
// ...
  const timerActive = g.isHumanTurn && g.state.phase === "placing" && g.state.pendingCard !== null;
  const localSeconds = useTimer(!roomId && timerActive, TURN_TIMEOUT_MS, g.timeout);
  const remoteSeconds = useRemoteTimer(client.db, roomId ?? "", !!roomId && timerActive, TURN_TIMEOUT_MS, g.timeout);
  const secondsLeft = roomId ? remoteSeconds : localSeconds;

  // Detects and reports the OPPONENT's timeout — separate from the display
  // countdown above. Its return value is intentionally unused; only
  // onExpire's side effect (calling g.timeout(), which no-ops unless
  // state.turn !== you) matters here.
  useRemoteTimer(
    client.db,
    roomId ?? "",
    !!roomId && !g.isHumanTurn && g.state.phase === "placing",
    TURN_TIMEOUT_MS,
    g.timeout,
  );
```

Add two lines to `useLobby.ts` (both `create` and `join`, right after
`setYou("p1")` / `setYou("p2")`) to persist `you` for navigation:

```ts
sessionStorage.setItem("duelPoker-you-" + id, "p1"); // and "p2" in join()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/ui/screens/GameScreen.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/GameScreen.tsx src/ui/screens/GameScreen.test.tsx src/ui/hooks/useLobby.ts
git commit -m "feat(ui): wire GameScreen to solo/multiplayer by route, add remote turn timer"
```

---

### Task 10: Strike indicator

**Files:**
- Create: `src/ui/components/StrikeIndicator.tsx`, `StrikeIndicator.module.css`
- Test: `src/ui/components/StrikeIndicator.test.tsx`
- Modify: `src/ui/screens/GameScreen.tsx` (render it)

**Interfaces:**
- Consumes: `MAX_STRIKES` (`engine/constants.ts`), `state.strikes`
  (`engine/types.ts`'s `GameState`).
- Produces: `<StrikeIndicator strikes={number} max={number} />` — this is
  presentational only, safe to build independently of the protocol work.

- [ ] **Step 1: Write the failing test**

```tsx
// src/ui/components/StrikeIndicator.test.tsx
import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { StrikeIndicator } from "./StrikeIndicator";

describe("StrikeIndicator", () => {
  test("renders one dot per strike slot, filled dots equal to `strikes`", () => {
    render(<StrikeIndicator strikes={2} max={3} />);
    const dots = screen.getAllByTestId(/strike-dot-/);
    expect(dots).toHaveLength(3);
    expect(dots.filter((d) => d.dataset.filled === "true")).toHaveLength(2);
  });

  test("has an accessible label summarizing the count", () => {
    render(<StrikeIndicator strikes={1} max={3} />);
    expect(screen.getByLabelText("1 of 3 strikes")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/ui/components/StrikeIndicator.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```tsx
// src/ui/components/StrikeIndicator.tsx
import { cn } from "../cn";
import styles from "./StrikeIndicator.module.css";

export type StrikeIndicatorProps = {
  strikes: number;
  max: number;
};

export function StrikeIndicator({ strikes, max }: StrikeIndicatorProps) {
  return (
    <div className={styles.row} role="img" aria-label={`${strikes} of ${max} strikes`}>
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          data-testid={`strike-dot-${i}`}
          data-filled={i < strikes}
          className={cn(styles.dot, i < strikes && styles.filled)}
        />
      ))}
    </div>
  );
}
```

```css
/* src/ui/components/StrikeIndicator.module.css */
.row {
  display: flex;
  gap: 6px;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--color-surface-muted, #3a3a3a);
}

.filled {
  background: var(--color-danger, #e5484d);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/ui/components/StrikeIndicator.test.tsx`
Expected: PASS

Wire it into `GameScreen.tsx` (both modes — `g.state.strikes` exists on
both `SoloGame`'s and `useMultiplayerGame`'s `GameState`):

```tsx
import { MAX_STRIKES } from "../../engine/constants";
import { StrikeIndicator } from "../components/StrikeIndicator";
// ...
        <div className={styles.strikes}>
          <StrikeIndicator strikes={g.state.strikes[g.you]} max={MAX_STRIKES} />
          <StrikeIndicator strikes={g.state.strikes[otherPlayer(g.you)]} max={MAX_STRIKES} />
        </div>
```

(`otherPlayer` import from `engine/deck.ts`.)

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/StrikeIndicator.tsx src/ui/components/StrikeIndicator.module.css src/ui/components/StrikeIndicator.test.tsx src/ui/screens/GameScreen.tsx
git commit -m "feat(ui): strike indicator dots for both players"
```

---

### Task 10b: Engine — FORFEIT event

**Why this task exists:** Task 11's original "claim win" sketch called
`timeout()` three times in a row to force a 3-strikes forfeit. That does
not work: `timeout()` dispatches synchronously against a `state` closure
that does not change across three calls in the same synchronous loop, so
the in-flight guard (`timedOutForDraw.current`) lets only the first call
through — one strike, not three. Even fixed, the game rule requires three
*consecutive actual turns* to time out; a disconnected opponent does not
get three turns in a row while sitting disconnected. Claiming a win needs
an immediate, one-shot forfeit — a different thing from the strike system.

**Files:**
- Modify: `src/engine/types.ts` (one new `GameEvent` variant)
- Modify: `src/engine/reducer.ts`
- Test: the reducer test file used by Tasks 5b/7b

**Interfaces (produces, consumed by Task 11):**
- `{ type: "FORFEIT"; by: PlayerId }` — `by` is the player who forfeits
  (the disconnected one, NOT the claimer). No preconditions beyond
  `state.phase !== "result"` (a forfeit can happen from any live phase —
  placing, replace, or reveal — since disconnection isn't tied to a
  specific phase). Reuses `forfeitState(state, by)` (the helper Task 7b
  extracted from `applyTimeout`'s forfeit branch) directly — no strike
  increment, no auto-placement, just the same forfeit `GameResult` shape
  every other forfeit path already produces.

- [ ] **Step 1: Write failing tests:** forfeits from each of `placing`,
  `replace`, and `reveal` phase, producing the same `GameResult` shape
  `applyTimeout`'s forfeit path does for the same `by`; rejects when
  `phase === "result"` already.
- [ ] **Step 2: Run to verify failure:** `pnpm test src/engine`
- [ ] **Step 3: Implement** — `case "FORFEIT": return applyForfeit(state, event.by);`
  where `applyForfeit` is a one-line call into the existing `forfeitState`
  helper plus its precondition assert. Do not duplicate `forfeitState`'s
  logic.
- [ ] **Step 4:** `pnpm test`, `pnpm exec tsc -b`, `pnpm lint` — all green,
  no existing test changed.
- [ ] **Step 5: Commit**

```bash
git add src/engine
git commit -m "feat(engine): FORFEIT event for an immediate, one-shot forfeit (disconnect claim)"
```

---

### Task 10c: One turn-aware timer, 90-second turns

**Why:** (1) The developer wants 90s turns (`TURN_TIMEOUT_MS`), and a timer that starts when the turn starts, not when the card is drawn. (2) Task 9 used two `useRemoteTimer` instances as a workaround. Experiments proved two defects in the hook: with ONE instance its "already fired" latch never resets, so timeouts stop working after the first turn (the reason for the workaround); and when an instance is re-activated it reuses the PREVIOUS turn's timestamp until the new one arrives, so it can fire an immediate false timeout (the workaround's own bug). The fix is to make the hook turn-aware.

**Files:**
- Modify: `src/engine/constants.ts` (`TURN_TIMEOUT_MS = 90_000`)
- Modify: `src/ui/hooks/useRemoteTimer.ts` and `useRemoteTimer.test.ts`
- Modify: `src/ui/screens/GameScreen.tsx` and `GameScreen.test.tsx`
- Modify docs: `docs/chinese-poker-spec-v2.md` lines mentioning the 60s TURN timer (about lines 112, 561, 584) to 90s. Leave the 60s DISCONNECT timeout alone.
- Do NOT touch `src/ui/hooks/useTimer.ts` (it carries a developer TODO comment; the developer edits it themselves) and do NOT stage `docs/chinese-poker-implementation-plan.md` (developer edit). Stage only the explicit paths you changed.

**Contract for `useRemoteTimer(db, roomId, active, durationMs, onExpire, turnKey): number`** (`turnKey: string`, new last parameter):
- The hook tracks one turn at a time, identified by `turnKey`. When `turnKey` changes (or `active` flips false): remember the current timestamp as `stale`, set `startedAt = null`, and clear the fired latch.
- The Firebase callback ignores a value equal to `stale`, and accepts the first different value as the new turn's start. Until then the countdown shows the full duration and `onExpire` cannot fire.
- `onExpire` fires at most once per turn (per `turnKey`), never on a timestamp belonging to a previous turn, including the gap between a turn changing locally and its new timestamp arriving.
- Required tests (fake timers, mock `subscribeToTurnStarted` so the value is delivered LATER by calling the captured callback): (A) re-activation / new turn does not fire on the previous turn's stale timestamp; (B) one instance that stays active fires once on turn 1 and again on turn 2; (C) the old timestamp expiring during the gap after `turnKey` changes does not fire for the new turn; (D) first-ever activation (no stale value) works; (E) countdown shows remaining time, not the full duration, once a timestamp arrives.

**GameScreen:** replace the two multiplayer `useRemoteTimer` calls with ONE: `active = !!roomId && g.state.phase === "placing"`, `turnKey = g.state.phase + ":" + g.state.turn`, `onExpire = g.timeout` (it no-ops on my own turn by design; it reports the opponent's timeout on theirs). Display the returned seconds only when `g.isHumanTurn` and phase is placing (no `pendingCard` requirement in multiplayer). Solo keeps `useTimer` exactly as is. Update `GameScreen.test.tsx` to assert the single call's args (active flag, turnKey value, onExpire is `handle.timeout`).

- [ ] Step 1: write failing tests. Step 2: confirm failure. Step 3: implement. Step 4: `pnpm test`, `pnpm exec tsc -b`, `pnpm lint` all green (some existing tests may hardcode 60 seconds for the TURN timer; update those expectations to 90 and mention it in your report). Step 5: commit with explicit paths.

---

### Task 10d: Split `useMultiplayerGame` into a folder of focused hooks

**Why:** `src/ui/hooks/useMultiplayerGame.ts` is ~900 lines with one ~200-line effect. The developer wants it split into several files/hooks composed by a thin root, while the async behavior stays exactly the same. This is a PURE MOVE: no behavior change.

**Target layout:**
```
src/crypto/drawSchedule.ts (+ drawSchedule.test.ts)   pure: DEAL_SLOTS, placingTurnOwner, isFaceDownDraw, replaceDrawIndex, validReplaceHand
src/ui/hooks/multiplayer/
  useMultiplayerGame.ts    root: builds ctx, calls the hooks below in order, returns the MultiplayerGame handle (+ exports MultiplayerGame / MultiplayerGameOptions types)
  context.ts               the MultiplayerCtx type + the shared-ref bundle type
  useProtocol.ts           protocol ref, protocolQueue, protocolTick, violated, updateProtocol, recordViolation, warnOnce
  useShuffle.ts            dealer subscription, seed + commitments, commitments subscription, both selector position-reveal effects, reveals subscription (+ answerWithCard)
  useOpeningDeal.ts        the DEAL-assembly effect
  useOpponentEvents.ts     events subscription, the queue, and the intake effect reduced to a thin dispatcher calling NAMED handlers: handleOpponentEndTurn, handleOpponentReplace, handleOpponentTimeout (the TIMEOUT / TIMEOUT_HIDDEN logic incl. the bounded own-hidden-timeout wait), plus the "unhandled type" warn-once fallback
  useTurnDraws.ts         the per-turn DRAW / REPLACE_DRAW resolve effect
  useRevealPhase.ts        the three reveal-phase effects (publish batch, verify, dispatch REVEAL_FACE_DOWN)
  myMoves.ts               placePending, replace, timeout, commitOwnFaceDownCard as plain functions taking ctx (no effects)
  useMultiplayerGame.emulator.test.ts   moved here from hooks/, only its import / vi.mock paths change
```
`src/ui/hooks/useMultiplayerGame.ts` must no longer exist; update every importer (`GameScreen.tsx`, `GameScreen.test.tsx` mocks, anything else found by grep).

**Async-safety rules (the point of this task; the two-client emulator tests are the safety net):**
1. Preserve the ORIGINAL RELATIVE ORDER in which the effects run within a commit. Original order: dealer subscription, seed/commitments publish, commitments subscription, selector opening positions, selector per-turn positions, reveals subscription, DEAL assembly, events subscription, intake, per-turn DRAW resolve, batch publish, batch verify, REVEAL_FACE_DOWN. Call the sub-hooks in an order that keeps that sequence (the layout above does: useProtocol, useShuffle, useOpeningDeal, useOpponentEvents, useTurnDraws, useRevealPhase).
2. Keep every effect's dependency array EXACTLY as it is (including the deliberately dependency-less ones and their explanatory comments; they re-check after every render because they read refs).
3. `updateProtocol` / `protocolQueue` / `protocolTick` semantics unchanged: ONE promise chain, steps read `protocol.current` only when they run, a rejection is recorded as a violation and never breaks the chain, `bumpTick` after every step.
4. Each mutable ref has exactly ONE owner and is shared by passing it (via `ctx`), never duplicated. Refs that cross modules: protocol handle (useProtocol), dealerState / selectorState (useShuffle), the placement-salt and slot-draw maps and the in-flight guards (`placedForDraw`, `replacedForDraw`, `timedOutForDraw`, `timedOutOwnHiddenForDraw`), created once in the root and passed through ctx.
5. `ctx` is rebuilt each render with the latest `state`; functions that read `state` (placePending, replace, timeout, the handlers) must still read the render's snapshot exactly as today.
6. Hooks are called unconditionally in a fixed order every render.

**Other requirements:** the pure helpers move to `crypto/drawSchedule.ts` with NEW table-driven unit tests (for both players over draw indices 0..51: exactly 5 face-down placing draws each, at indices 40,42,44,46,48 for p1 and 41,43,45,47,49 for p2; none outside 10..49; placingTurnOwner alternates starting with p1; replaceDrawIndex is 50 for p1 and 51 for p2; DEAL_SLOTS maps 0->p1 hand0, 1->p2 hand0 ... 9->p2 hand4; validReplaceHand cases incl. null / undefined / out-of-range / non-integer). No barrel file. No new behavior, no renames of exported types. Keep lint at 0 errors and no more than the existing 2 exhaustive-deps warnings.

**Verification (all required, with output in the report):** `pnpm test:emulator:ui` three consecutive times with the unchanged assertions; `pnpm test`; `pnpm test:emulator`; `pnpm exec tsc -b`; `pnpm lint`.

**Downstream map for Tasks 11-15** (where code lands after this split): claimWin -> `myMoves.ts`; FORFEIT / REMATCH intake -> `useOpponentEvents.ts`; rematch / score / recovery effects -> new `use*.ts` files in `multiplayer/`, called from the root; violation flag stays on the root handle.

- [ ] Commit in at most two commits with explicit paths (suggested: "refactor(crypto): extract draw schedule helpers with tests" then "refactor(ui): split useMultiplayerGame into focused hooks").

---

### Task 11: Disconnect overlay

> **FILE LOCATIONS CHANGED (Task 10d, 2026-10-03).** `src/ui/hooks/useMultiplayerGame.ts` no longer exists. Read `src/ui/hooks/multiplayer/` first (root `useMultiplayerGame.ts` ~99 lines + `context.ts`, `useProtocol`, `useShuffle`, `useOpeningDeal`, `useOpponentEvents`, `useTurnDraws`, `useRevealPhase`, `myMoves.ts`). Wherever this task says "`useMultiplayerGame.ts`", map as follows: `claimWin` is a plain function in `myMoves.ts` (like `timeout`), exposed by the root handle and added to the `MultiplayerGame` type in the root file; the incoming-FORFEIT intake is a new branch in the thin dispatcher in `useOpponentEvents.ts`, handled by a small NAMED handler (`handleOpponentForfeit`), NOT inlined into the dispatcher. The emulator test lives in `multiplayer/useMultiplayerGame.emulator.test.ts`. Add a hook-level emulator test for claimWin: one client calls it, both clients end in `result` with `forfeitedBy` the disconnected player and the winner the claimer. Turn timer is now 90s (`TURN_TIMEOUT_MS`); the DISCONNECT countdown in this task stays 60s. Stage explicit paths only; never touch the developer-owned `src/ui/hooks/useTimer.ts` or `docs/chinese-poker-implementation-plan.md`. Commit messages go via `git commit -F` with a POSIX scratchpad path (see earlier dispatches).

**Files:**
- Create: `src/ui/components/DisconnectOverlay.tsx`, `DisconnectOverlay.module.css`
- Test: `src/ui/components/DisconnectOverlay.test.tsx`
- Modify: `src/ui/screens/GameScreen.tsx` (wire presence + the overlay)

**Interfaces:**
- Consumes: `subscribeToPresence` (`net/sync.ts`, already built in Phase 6),
  a 60s countdown (reuse `useTimer`, not `useRemoteTimer` — disconnect
  timing is judged locally per the spec's "60s disconnect timeout"
  decision, not server-anchored).
- Produces:
  `<DisconnectOverlay opponentPresent={boolean} onClaimWin={() => void} />`
  — shows nothing while `opponentPresent`; a countdown then a "Claim win"
  button once it's been absent 60s.

- [ ] **Step 1: Write the failing test**

```tsx
// src/ui/components/DisconnectOverlay.test.tsx
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { DisconnectOverlay } from "./DisconnectOverlay";

describe("DisconnectOverlay", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("renders nothing while the opponent is present", () => {
    render(<DisconnectOverlay opponentPresent onClaimWin={vi.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("shows a countdown once the opponent disconnects, then a Claim win button", () => {
    render(<DisconnectOverlay opponentPresent={false} onClaimWin={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /claim win/i })).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByRole("button", { name: /claim win/i })).toBeInTheDocument();
  });

  test("clicking Claim win calls onClaimWin", () => {
    const onClaimWin = vi.fn();
    render(<DisconnectOverlay opponentPresent={false} onClaimWin={onClaimWin} />);
    act(() => vi.advanceTimersByTime(60_000));
    screen.getByRole("button", { name: /claim win/i }).click();
    expect(onClaimWin).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/ui/components/DisconnectOverlay.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```tsx
// src/ui/components/DisconnectOverlay.tsx
import { useTimer } from "../hooks/useTimer";
import styles from "./DisconnectOverlay.module.css";

const DISCONNECT_TIMEOUT_MS = 60_000;

export type DisconnectOverlayProps = {
  opponentPresent: boolean;
  onClaimWin: () => void;
};

export function DisconnectOverlay({ opponentPresent, onClaimWin }: DisconnectOverlayProps) {
  const secondsLeft = useTimer(!opponentPresent, DISCONNECT_TIMEOUT_MS, () => {});
  if (opponentPresent) return null;

  const expired = secondsLeft <= 0;
  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Opponent disconnected">
      {expired ? (
        <>
          <p className={styles.message}>Your opponent has not reconnected.</p>
          <button className={styles.primary} onClick={onClaimWin}>
            Claim win
          </button>
        </>
      ) : (
        <p className={styles.message}>Opponent reconnecting… 0:{String(secondsLeft).padStart(2, "0")}</p>
      )}
    </div>
  );
}
```

```css
/* src/ui/components/DisconnectOverlay.module.css */
.overlay {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: rgba(0, 0, 0, 0.6);
  z-index: 20;
}

.message {
  color: var(--color-text, #fff);
  font-size: 1.1rem;
}

.primary {
  padding: 10px 24px;
  border-radius: 8px;
  background: var(--color-accent, #5b8def);
  color: #fff;
  border: none;
  cursor: pointer;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/ui/components/DisconnectOverlay.test.tsx`
Expected: PASS

> **CONTROLLER AMENDMENT — claimWin uses Task 10b's FORFEIT event, not a
> timeout hack.** Add `claimWin(): void` to `useMultiplayerGame.ts`'s
> return value (and to the `MultiplayerGame` type — it's multiplayer-only,
> not part of the shared `SoloGame`/`GameHandle` shape, since solo has no
> disconnect concept). It dispatches and publishes
> `{ type: "FORFEIT", by: otherPlayer(you) }` — trusted as-is, no
> commit-reveal verification needed (presence is written by the opponent's
> own `onDisconnect` handler, not forgeable by the claimer). No-op if
> `state.phase === "result"` already. Also add `FORFEIT` to the opponent-
> event intake's handled set (applied directly, same trust level as
> `TIMEOUT`) so a client that reconnects after the opponent already
> claimed a win converges to the same result instead of hitting the
> "blocked, not handled yet" warn-once fallback.

Add to `useMultiplayerGame.ts` (near `timeout()`):

```ts
  function claimWin(): void {
    if (!role || state.phase === "result") return;
    const event: GameEvent = { type: "FORFEIT", by: otherPlayer(you) };
    try {
      dispatch(event);
    } catch (err) {
      console.error("[useMultiplayerGame] local FORFEIT rejected by reducer", err);
      recordViolation(`local FORFEIT failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    publishEvent(db, roomId, event).catch((err: unknown) => {
      console.error("[useMultiplayerGame] failed to publish FORFEIT", err);
    });
  }
```

And in the opponent-event intake effect (alongside the existing
`REPLACE`/`TIMEOUT`/`TIMEOUT_HIDDEN` branches, before the `END_TURN`
check):

```ts
    if (event.type === "FORFEIT") {
      opponentEvents.current.shift();
      dispatch(event);
      return;
    }
```

Add `claimWin` to the hook's return object and to `MultiplayerGame`'s type
declaration near the top of the file.

Wire into `GameScreen.tsx` for the multiplayer branch only (solo has no
opponent presence to watch). Note: reference `multiplayer.claimWin`
directly, not `g.claimWin` — `claimWin` isn't on the shared `g` handle's
type since solo doesn't have it:

```tsx
  const [opponentPresent, setOpponentPresent] = useState(true);
  useEffect(() => {
    if (!roomId) return;
    return subscribeToPresence(client.db, roomId, (presence) => {
      setOpponentPresent(presence[otherPlayer(readYou(roomId))] === true);
    });
  }, [roomId, client.db]);
// ...
        {roomId && (
          <DisconnectOverlay opponentPresent={opponentPresent} onClaimWin={multiplayer.claimWin} />
        )}
```

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/DisconnectOverlay.tsx src/ui/components/DisconnectOverlay.module.css src/ui/components/DisconnectOverlay.test.tsx src/ui/screens/GameScreen.tsx src/ui/hooks/useMultiplayerGame.ts
git commit -m "feat(ui): disconnect overlay with 60s claim-win countdown"
```

---

### Task 12: Rematch flow

**Files:**
- Modify: `src/ui/hooks/useMultiplayerGame.ts` (implement `playAgain()`)
- Modify: `src/ui/screens/GameScreen.tsx` (pass rematch state to `ResultOverlay`)
- Test: `src/ui/hooks/useMultiplayerGame.emulator.test.ts` (extend)

**Interfaces:**
- Consumes: `publishRematchVote`, `subscribeToRematch`, `resetForRematch`,
  `subscribeToGameNumber` (`net/roomState.ts`, Task 4).
- Produces: `playAgain()` votes for a rematch; once both players have
  voted, one deterministic client (`you === "p1"`, avoiding a double
  reset race) calls `resetForRematch`, flipping the dealer. Both clients'
  `useGameEngine` gets a fresh `REMATCH` dispatch once the new
  `gameNumber` and `dealer` are observed, restarting Task 5's shuffle
  effects (the hook's `dealt`/`publishedPosition`/etc. refs must reset too).

- [ ] **Step 1: Write the failing test**

```ts
// append to src/ui/hooks/useMultiplayerGame.emulator.test.ts
test("both players voting rematch resets the log and flips the dealer", async () => {
  await publishDealer(db, roomId, "p1");
  const p1 = renderHook(() => useMultiplayerGame({ db, roomId, you: "p1", gameNumber: 1 }));
  const p2 = renderHook(() => useMultiplayerGame({ db, roomId, you: "p2", gameNumber: 1 }));
  await waitFor(() => expect(p1.result.current.state.phase).toBe("placing"), { timeout: 5000 });

  await act(async () => p1.result.current.playAgain());
  await act(async () => p2.result.current.playAgain());

  await waitFor(
    () => {
      expect(p1.result.current.state.turn).toBe("p2"); // dealer flipped, deals first
      expect(p1.result.current.state.drawCount).toBe(0);
    },
    { timeout: 5000 },
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:emulator:ui` (runs every *.emulator.test.ts under src/ui via the jsdom+emulator config added in Task 5 Step 0)
Expected: FAIL — `playAgain` still a no-op.

- [ ] **Step 3: Implement**

```ts
  async function playAgain() {
    await publishRematchVote(db, roomId, you);
  }
```

```ts
  useEffect(() => {
    return subscribeToRematch(db, roomId, async (votes) => {
      if (votes.p1 && votes.p2 && you === "p1") {
        const nextDealer = otherPlayer(dealer ?? "p1");
        await resetForRematch(db, roomId, nextDealer, gameNumber + 1);
      }
    });
  }, [db, roomId, you, dealer, gameNumber]);
```

Reset local refs and re-dispatch `REMATCH` when a new `gameNumber` shows up:

```ts
  useEffect(() => {
    return subscribeToGameNumber(db, roomId, (n) => {
      if (n <= gameNumber) return;
      // A parent (GameScreen) owns `gameNumber` as a route/state value in
      // a real deployment; this hook instance is remounted with the new
      // gameNumber by that parent once it observes the bump. Nothing to
      // do here beyond letting the effect fire once, which happens
      // naturally on remount — this subscription exists purely so
      // GameScreen has something to key off of (see Task 13).
    });
  }, [db, roomId, gameNumber]);
```

Note for the implementer: `useMultiplayerGame` takes `gameNumber` as a
prop rather than tracking it internally, matching `useSoloGame`'s
`firstTurn` pattern — the caller (`GameScreen`, Task 13) owns bumping it
and remounting the hook via a `key`, which is the simplest way to reset
every `useRef` (`dealt`, `publishedPosition`, `protocol`, etc.) without
manually clearing a dozen refs.

Update `GameScreen.tsx`:

```tsx
  const [gameNumber, setGameNumber] = useState(1);
  useEffect(() => {
    if (!roomId) return;
    return subscribeToGameNumber(client.db, roomId, setGameNumber);
  }, [roomId, client.db]);

  const multiplayer = useMultiplayerGame({
    db: client.db,
    roomId: roomId ?? "",
    you: roomId ? readYou(roomId) : "p1",
    gameNumber,
  });
```

Because `gameNumber` is now a hook argument that changes, React remounts
the *internal* refs are still stale across a `gameNumber` change unless the
whole hook instance remounts — add `key={gameNumber}` to whichever
component tree renders per-game state, e.g. wrap the board section:

```tsx
      <div className={styles.screen} data-testid="game-screen" key={roomId ? gameNumber : "solo"}>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:emulator:ui` (runs every *.emulator.test.ts under src/ui via the jsdom+emulator config added in Task 5 Step 0)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/hooks/useMultiplayerGame.ts src/ui/hooks/useMultiplayerGame.emulator.test.ts src/ui/screens/GameScreen.tsx
git commit -m "feat(ui): rematch flow — vote, reset room state, flip dealer"
```

---

### Task 13: Session score

**Files:**
- Modify: `src/ui/screens/GameScreen.tsx`
- Modify: `src/ui/components/ResultOverlay.tsx` (accept optional session score)
- Test: `src/ui/components/ResultOverlay.test.tsx` (extend)

**Interfaces:**
- Consumes: `subscribeToScore`, `incrementScore` (`net/roomState.ts`, Task 4).
- Produces: `ResultOverlay` gains an optional `sessionScore?: { you: number; opponent: number }`
  prop, rendered above the per-game score when present (solo passes
  nothing — no session tracking there, matching current behavior).

- [ ] **Step 1: Write the failing test**

```tsx
// append to src/ui/components/ResultOverlay.test.tsx
test("renders the session score when provided", () => {
  render(
    <ResultOverlay
      result={/* existing fixture result from the file above */ fixtureResult}
      you="p1"
      onPlayAgain={vi.fn()}
      sessionScore={{ you: 3, opponent: 1 }}
    />,
  );
  expect(screen.getByText(/session: 3 – 1/i)).toBeInTheDocument();
});
```

(Use whatever `GameResult` fixture the existing test file already builds —
match its name instead of `fixtureResult` if different.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/ui/components/ResultOverlay.test.tsx`
Expected: FAIL — `sessionScore` prop not accepted / text not rendered.

- [ ] **Step 3: Implement**

```tsx
// src/ui/components/ResultOverlay.tsx — extend the props and JSX
export type ResultOverlayProps = {
  result: GameResult;
  you: PlayerId;
  onPlayAgain: () => void;
  sessionScore?: { you: number; opponent: number };
};

export function ResultOverlay({ result, you, onPlayAgain, sessionScore }: ResultOverlayProps) {
  // ...existing body...
  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Game result">
      <h2 className={cn(styles.title, styles[outcome])}>{titleFor(outcome)}</h2>
      <p className={styles.score}>
        {yourWins} – {opponentWins}
      </p>
      {sessionScore && (
        <p className={styles.sessionScore}>
          Session: {sessionScore.you} – {sessionScore.opponent}
        </p>
      )}
      {/* ...unchanged matchups/actions... */}
    </div>
  );
}
```

Add the class to `ResultOverlay.module.css` (reuse `.score`'s sizing at a
smaller scale — check the existing file for its variable names before
adding a new one).

Wire it in `GameScreen.tsx`:

```tsx
  const [score, setScore] = useState({ p1: 0, p2: 0 });
  useEffect(() => {
    if (!roomId) return;
    return subscribeToScore(client.db, roomId, setScore);
  }, [roomId, client.db]);

  const scoredOnce = useRef(false);
  useEffect(() => {
    if (!roomId || g.state.phase !== "result" || !g.state.result) return;
    if (g.state.result.winner === "draw" || scoredOnce.current) return;
    scoredOnce.current = true;
    void incrementScore(client.db, roomId, g.state.result.winner);
  }, [roomId, client.db, g.state.phase, g.state.result]);
// ...
        {g.state.phase === "result" && g.state.result && (
          <ResultOverlay
            result={g.state.result}
            you={g.you}
            onPlayAgain={g.playAgain}
            sessionScore={
              roomId ? { you: score[g.you], opponent: score[otherPlayer(g.you)] } : undefined
            }
          />
        )}
```

(Reset `scoredOnce.current = false` alongside the other per-game refs —
since this ref lives in `GameScreen`, not the hook, and the board section
already remounts via `key={gameNumber}` from Task 12, it resets for free.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/ui/components/ResultOverlay.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/ResultOverlay.tsx src/ui/components/ResultOverlay.module.css src/ui/components/ResultOverlay.test.tsx src/ui/screens/GameScreen.tsx
git commit -m "feat(ui): session score tracked and shown on the result overlay"
```

---

### Task 14: Refresh recovery

**Files:**
- Modify: `src/ui/hooks/useMultiplayerGame.ts`
- Test: `src/ui/hooks/useMultiplayerGame.emulator.test.ts` (extend)

**Interfaces:**
- Consumes: `subscribeToEvents` (`net/sync.ts`, Phase 6), `replay`
  (`engine/reducer.ts`, already exported), `loadSeed` (`crypto/seedStorage.ts`).
- Produces: on mount, before doing anything else, the hook replays any
  events already in `/rooms/{roomId}/events` through `gameReducer` to
  reach the current `GameState` synchronously, *then* resumes the live
  reveal-chain subscriptions from Tasks 5-7 (which naturally no-op for
  draw indices already resolved, since `publishedPosition`/`publishedCard`
  would need to be seeded from the replay too — see implementation below).

- [ ] **Step 1: Write the failing test**

```ts
// append to src/ui/hooks/useMultiplayerGame.emulator.test.ts
test("remounting mid-game (simulated refresh) recovers the same state", async () => {
  await publishDealer(db, roomId, "p1");
  const p1 = renderHook(() => useMultiplayerGame({ db, roomId, you: "p1", gameNumber: 1 }));
  const p2 = renderHook(() => useMultiplayerGame({ db, roomId, you: "p2", gameNumber: 1 }));
  await waitFor(() => expect(p1.result.current.state.phase).toBe("placing"), { timeout: 5000 });

  const stateBeforeRefresh = p1.result.current.state;
  p1.unmount(); // simulates a page refresh dropping the p1 client

  const p1Again = renderHook(() => useMultiplayerGame({ db, roomId, you: "p1", gameNumber: 1 }));
  await waitFor(
    () => expect(p1Again.result.current.state).toEqual(stateBeforeRefresh),
    { timeout: 5000 },
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:emulator:ui` (runs every *.emulator.test.ts under src/ui via the jsdom+emulator config added in Task 5 Step 0)
Expected: FAIL — a fresh mount currently starts from scratch and re-shuffles
with a *new* seed (no seed was loaded, since none was ever an exact miss —
actually `loadSeed` already returns the prior seed via `seedStorage`, so
the shuffle recomputes identically; what's missing is replaying `events`
and seeding `publishedPosition`/`publishedCard`/`dealt` from them, so the
freshly-mounted client doesn't try to re-run `DEAL` or diverge on
`drawCount`).

- [ ] **Step 3: Implement**

Add a replay effect that runs once, before the reveal-chain effects rely on
`state.drawCount`:

```ts
  const recovered = useRef(false);
  useEffect(() => {
    if (recovered.current) return;
    recovered.current = true;
    let cancelled = false;
    const events: GameEvent[] = [];
    const unsubscribe = subscribeToEvents(db, roomId, (event) => {
      if (cancelled) return;
      events.push(event);
    });
    // subscribeToEvents (onChildAdded) fires synchronously for every
    // existing child before this line returns in the RTDB SDK's local
    // cache path used by the emulator/tests; give it one microtask to be
    // safe in production against a slower initial fetch.
    void Promise.resolve().then(() => {
      if (cancelled) return;
      unsubscribe();
      if (events.length === 0) return;
      for (const event of events) {
        dispatch(event);
        if (event.type === "DEAL") dealt.current = true;
      }
      const finalDrawCount = events.reduce(
        (n, e) => (e.type === "DRAW" || e.type === "REPLACE_DRAW" ? n + 1 : n),
        HANDS_PER_PLAYER * 2 * (events.some((e) => e.type === "DEAL") ? 1 : 0),
      );
      for (let i = 0; i < finalDrawCount; i++) {
        publishedPosition.current.add(i);
        publishedCard.current.add(i);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [db, roomId, dispatch]);
```

Note for the implementer: this marks past draw indices as already
published on *both* halves so the eager-reveal effects don't try to
re-publish reveals for cards already resolved — the protocol controller's
own `protocol.current.positions`/`.cards` maps are rebuilt for free by the
normal `subscribeToReveals` effect (Task 5) replaying the full
`/protocol/reveals` log the same way `subscribeToEvents` does for
`/events`, since both are `onChildAdded` subscriptions that fire for
existing children on subscribe — no separate replay path needed for the
protocol log itself.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:emulator:ui` (runs every *.emulator.test.ts under src/ui via the jsdom+emulator config added in Task 5 Step 0)
Expected: PASS (all cases in the file)

- [ ] **Step 5: Commit**

```bash
git add src/ui/hooks/useMultiplayerGame.ts src/ui/hooks/useMultiplayerGame.emulator.test.ts
git commit -m "feat(ui): refresh recovery — replay the event log on mount"
```

---

### Task 15: Protocol violation handling

**Files:**
- Modify: `src/ui/hooks/useMultiplayerGame.ts` (surface `hasViolation`)
- Create: `src/ui/components/ProtocolErrorScreen.tsx`, `ProtocolErrorScreen.module.css`
- Test: `src/ui/components/ProtocolErrorScreen.test.tsx`
- Modify: `src/ui/screens/GameScreen.tsx` (render it instead of the board)

**Interfaces:**
- Consumes: `hasViolation` (`crypto/protocolController.ts`, Task 2),
  `GameHandle` (`ui/hooks/gameHandle.ts`, Task 9).
- Produces: `useMultiplayerGame`'s return type becomes
  `GameHandle & { protocolViolation: boolean }` — multiplayer-only, so it's
  an intersection on top of the shared type rather than a field added to
  `GameHandle` itself (solo has no protocol to violate).
  `<ProtocolErrorScreen />` renders a message and a "Leave" link to `/`.

**Known gap, acknowledged not fixed by this task:** `hasViolation` only
reflects draw-reveal (`position`/`card`) verification failures from Tasks
5-6. The reveal-phase `placementReveal` check added in Task 7 verifies
nothing yet — it receives the opponent's reveal but never calls
`applyCardReveal`-equivalent verification against the dealer's original
`placementCommit` hash. Closing this gap needs a
`applyPlacementReveal(state, handIndex, card, salt, commitment)` addition
to `protocolController.ts` (same shape as `applyCardReveal`, verifying
`commitPlacement(card, handIndex, salt) === commitment`) wired into Task
7's subscription. Flag this to the user as a follow-up task before
considering Phase 7 fully done — the game works end-to-end without it, but
a tampered face-down reveal in the final reveal phase would currently go
undetected.

- [ ] **Step 1: Write the failing test**

```tsx
// src/ui/components/ProtocolErrorScreen.test.tsx
import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProtocolErrorScreen } from "./ProtocolErrorScreen";

describe("ProtocolErrorScreen", () => {
  test("shows an error message and a Leave link back to home", () => {
    render(
      <MemoryRouter>
        <ProtocolErrorScreen />
      </MemoryRouter>,
    );
    expect(screen.getByText(/protocol error/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /leave/i })).toHaveAttribute("href", "/");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/ui/components/ProtocolErrorScreen.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```tsx
// src/ui/components/ProtocolErrorScreen.tsx
import { Link } from "react-router-dom";
import styles from "./ProtocolErrorScreen.module.css";

export function ProtocolErrorScreen() {
  return (
    <div className={styles.screen} role="alert">
      <h1 className={styles.title}>Protocol error</h1>
      <p className={styles.message}>
        Something your opponent's client sent didn't check out — this game can't
        continue safely.
      </p>
      <Link to="/" className={styles.primary}>
        Leave
      </Link>
    </div>
  );
}
```

```css
/* src/ui/components/ProtocolErrorScreen.module.css */
.screen {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  text-align: center;
  padding: 24px;
}

.title {
  color: var(--color-danger, #e5484d);
}

.primary {
  padding: 10px 24px;
  border-radius: 8px;
  background: var(--color-accent, #5b8def);
  color: #fff;
  text-decoration: none;
}
```

Surface it from the hook:

```ts
// in useMultiplayerGame.ts, in the return statement
  return {
    state,
    getEvents,
    you,
    legalHands,
    canDraw,
    isHumanTurn,
    aiThinking: false as const,
    protocolViolation: hasViolation(protocol.current),
    draw,
    placePending,
    replaceDraw,
    replace,
    timeout,
    playAgain,
  };
```

Wire into `GameScreen.tsx`:

```tsx
import { ProtocolErrorScreen } from "../components/ProtocolErrorScreen";
// ...
  if (roomId && multiplayer.protocolViolation) {
    return <ProtocolErrorScreen />;
  }
```

(Place this check right after the hooks and before the existing JSX
return, matching the early-return style already used elsewhere in this
codebase, e.g. `useLobby`'s guard clauses.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/ui/components/ProtocolErrorScreen.test.tsx`
Expected: PASS

Also run the full suite once, since this is the last task:

Run: `pnpm test`
Expected: PASS, all files.
Run: `pnpm exec tsc -b`
Expected: no errors.
Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/ProtocolErrorScreen.tsx src/ui/components/ProtocolErrorScreen.module.css src/ui/components/ProtocolErrorScreen.test.tsx src/ui/hooks/useMultiplayerGame.ts src/ui/screens/GameScreen.tsx
git commit -m "feat(ui): protocol violation screen halts the game on a failed verification"
```

---

## After all tasks

Run `pnpm build` once as a final check (`tsc -b` + Vite build catches
anything the per-task `tsc`/`lint` runs above didn't), then run
`graphify update .` to refresh the knowledge graph before merging
`phase-7-multiplayer` into `main`, per `CLAUDE.md`.
