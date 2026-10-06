# Phase 7 — Multiplayer Game Loop — Design

**Status:** approved by developer, 2026-09-22
**Depends on:** Phase 5 (crypto), Phase 6 (Firebase net layer)

## Goal

Two players can play a complete game end to end over Firebase RTDB: shuffle
via commit-reveal, draw, place, replace, reveal, see the winner, rematch —
with turn timeouts, disconnect handling, and refresh recovery.

## Core decision: commit-reveal verification lives outside the reducer

`gameReducer` must stay pure and synchronous (per `CLAUDE.md`); the
commit-reveal hash checks are async (WebCrypto `SHA-256`). So the reducer
gets no new event types for the protocol. Instead:

- A new **protocol controller** (`src/crypto/protocolController.ts`) owns the
  commit-reveal state machine. It consumes protocol messages (commitments,
  position reveals, card reveals) coming off Firebase, verifies each one
  against the published hash, and — only once a reveal is verified — emits a
  plain `DRAW` / `REPLACE_DRAW` event, the same event type solo mode already
  produces locally.
- The multiplayer game hook dispatches that event into the existing
  `useGameEngine`/`gameReducer`, unchanged from solo.
- `GameEvent` (`src/engine/types.ts`) is **not extended for the protocol** (superseded in part by the 2026-09-24 amendment below, which adds hidden-card events). The reducer and
  the solo/multiplayer split at `useGameEngine` stay exactly as they are
  today.

Two logs exist side by side in multiplayer:

- **Firebase log** (`/rooms/{roomId}/protocol/*` and `/rooms/{roomId}/events/*`)
  — the actual wire messages: commitments, reveals, and plain `GameEvent`s
  for the parts of the protocol that don't need verification (`END_TURN`,
  `REPLACE`, `TIMEOUT`, `REMATCH`, `ADVANCE_REVEAL`).
- **Reducer log** (`useGameEngine`'s internal `log`) — derived, exactly what
  solo mode already produces. On refresh this is rebuilt by replaying the
  Firebase log through the protocol controller again.

### Known asymmetry — not fixed this phase

The dealer privately knows the entire deck from the moment they shuffle it;
only the *selector's* face-down cards ever leak early (selector's-turn
reveals). A full fix needs a two-party "mental poker" shuffle (commutative
encryption) — out of scope. Kept as spec'd: single-dealer shuffle + dealer
role alternates every rematch. This matches the existing spec table entry
("good enough for casual play, much simpler to implement").

## RTDB shape additions

Building on the Phase 6 shape (`/rooms/{roomId}/{meta,seats,presence,events}`):

```
/rooms/{roomId}/
  protocol/
    dealer: "p1" | "p2"                       // who shuffles this game; alternates on rematch
    commitments/
      dealer:   [<52 hashes>]
      selector: [<52 hashes>]
    reveals/                                   // pushed one at a time, in order
      <pushId>: { by, kind: "position"|"card", index, value, salt, at }
  meta/
    turnStartedAt: <server timestamp>          // for the turn timer
  rematch/
    p1: boolean
    p2: boolean
  score/
    p1: number
    p2: number
  gameNumber: number
```

`events/*` keeps carrying exactly the `GameEvent`s from `engine/types.ts` —
`DEAL` is synthesized locally by both clients once dealing is complete
(deterministic from the verified draws), not published.

## Step plan (each step = one commit on `phase-7-multiplayer`)

1. **Protocol controller** (`src/crypto/protocolController.ts` + test) — pure
   state machine: given prior state + an incoming protocol message, returns
   next state and, when a full reveal completes, the `DRAW`/`REPLACE_DRAW`
   event to dispatch. No Firebase import (stays in `crypto/`, which may
   depend on `engine` only).
2. **Sync layer extension** (`src/net/sync.ts`) — `publishCommitments`,
   `publishReveal`, `subscribeToProtocol`, mirroring the existing
   `publishEvent`/`subscribeToEvents` shape.
3. **Multiplayer game hook** (`src/ui/hooks/useMultiplayerGame.ts`) — mirrors
   `useSoloGame`'s public shape (`state, getEvents, you, legalHands, canDraw,
   isHumanTurn, aiThinking: false, draw, placePending, replaceDraw, replace,
   timeout, playAgain`) so `GameScreen` can stay mode-agnostic. Wires
   `useGameEngine` + the protocol controller + sync subscriptions. Handles
   shuffling-phase commitment exchange.
4. **Turn timer wiring** (`src/ui/hooks/useTimer.ts` already exists from
   solo) — read `turnStartedAt` from RTDB instead of a local start time; on
   expiry only the *non-active* player writes `TIMEOUT`.
5. **Strike indicator** (`src/ui/components/StrikeIndicator.tsx`) — reads
   `state.strikes`, no new wiring, safe to build independently.
6. **Disconnect overlay** (`src/ui/components/DisconnectOverlay.tsx`) — reads
   presence from `useLobby`'s existing `subscribeToPresence`; countdown +
   "Claim win" after 60s.
7. **Rematch flow** — result overlay writes `/rematch/pX`; when both true,
   increment `gameNumber`, flip `protocol/dealer`, clear `events` +
   `protocol`, re-run the shuffling phase.
8. **Session score** — increment `/score/{winner}` on result, read on mount.
9. **Refresh recovery** — on mount, detect room from URL/localStorage,
   re-read `events` + `protocol` logs, replay through protocol controller +
   reducer, restore seed from `seedStorage`.
10. **Protocol violation handling** — verification failure in the controller
    surfaces as a distinct state; `GameScreen` shows a "Protocol error"
    screen with a "Leave" button.

## Testing

- Protocol controller: table-driven unit tests (co-located
  `protocolController.test.ts`) — valid reveal sequences, tampered
  hash/salt rejected, out-of-order messages.
- Sync extensions: Firebase emulator tests, following the existing
  `*.emulator.test.ts` pattern in `src/net/`.
- Multiplayer hook: mirror `useSoloGame.test.ts`'s structure against a fake
  Firebase double where feasible; two-client integration left to manual
  emulator testing (two browser tabs) as the deliverable states.

## Non-goals

- Fixing the dealer-knowledge asymmetry with a full mental-poker shuffle.
- Spectator mode, chat, or more than 2 players.
- Any change to `GameEvent`/`gameReducer` beyond the 2026-09-24 amendment.

## Amendment (2026-09-24): hidden face-down cards need a small engine extension

Found during Task 5 review: `scoreGame` runs inside `applyReplace`, before the
reveal phase, and the reducer's `DRAW` requires a concrete `Card`. On the
dealer's own face-down turn the selector must not learn the card, so its
client has nothing to put in `DRAW`, and its local scoring would disagree.
The earlier rule "`GameEvent`/`gameReducer` are not modified" is therefore
relaxed, by a deliberately small, synchronous, non-crypto addition:

- **`PLACE_HIDDEN { by, handIndex }`** — the selector-side counterpart of
  `DRAW` + `END_TURN` for a hidden card: places `{ faceUp: false }` with no
  `card`, advances `drawCount` and the turn. The dealer's own client still
  dispatches normal `DRAW` + `END_TURN` (it knows the card). A hidden
  replace-phase swap needs the equivalent (`REPLACE_HIDDEN`).
- **`REVEAL_FACE_DOWN { cards: Record<PlayerId, Card[]> }`** — one batched
  event (one card per hand index, per player) that fills in every missing
  face-down `card` and computes `result`. Hashes are verified by the protocol
  controller *before* dispatch, so the reducer stays pure and synchronous.
- **Deferred scoring:** `applyReplace` scores only when every card is known
  (always true in solo, so solo is unchanged); otherwise `result` stays
  `null` and `REVEAL_FACE_DOWN` computes it.
- **`ADVANCE_REVEAL` is unchanged** and stays local — pure animation pacing.
  It is no longer published to Firebase.

Reveal timing: each player publishes all their hidden cards in a single
`placementReveal` message once the replace phase ends; a client dispatches
`REVEAL_FACE_DOWN` when both players' reveals have verified.
