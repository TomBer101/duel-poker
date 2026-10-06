# Chinese Poker — Implementation Plan

**Spec reference:** `chinese-poker-spec-v2.md`
**Date:** 2026-08-05

---

## Guiding Principles

- **Build bottom-up:** pure engine first (testable without a browser), then crypto, then Firebase, then UI.
- **Each phase produces something testable** before moving on.
- **Solo mode first, multiplayer second.** Solo exercises the full engine + UI without Firebase/crypto complexity. Multiplayer adds networking and anti-cheat on top of a proven foundation.

---

## Phase 1 — Project Scaffolding

**Goal:** empty app that builds and runs.

### Steps

1. **Create repo and initialize Vite project**
   ```bash
   mkdir chinese-poker && cd chinese-poker
   npm create vite@latest . -- --template react-ts
   ```

2. **Install core dependencies**
   ```bash
   npm install tailwindcss @tailwindcss/vite
   npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
   npm install react-router-dom
   npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
   ```

3. **Configure Tailwind** — add `@tailwindcss/vite` plugin to `vite.config.ts`, add `@import "tailwindcss"` to CSS entry point.

4. **Configure Vitest** — add vitest config in `vite.config.ts`, create a test setup file.

5. **Set up path aliases** — `@/*` → `./src/*` in `tsconfig.json` and `vite.config.ts`.

6. **Create directory structure** — empty folders: `src/engine/`, `src/ai/`, `src/crypto/`, `src/net/`, `src/ui/screens/`, `src/ui/components/`, `src/ui/hooks/`.

7. **Set up routing** — React Router with routes: `/` (HomeScreen), `/room/:id` (GameScreen), `/solo` (GameScreen in solo mode).

8. **Create placeholder screens** — HomeScreen, GameScreen with minimal markup.

9. **Initialize git repo** — `.gitignore` (node_modules, dist, .env.local), initial commit.

10. **Create `.env.example`** — document all `VITE_FIREBASE_*` keys (empty values).

### Deliverable
App starts with `npm run dev`, shows a home screen with placeholder buttons, tests run with `npm test`.

---

## Phase 2 — Game Engine (Pure TypeScript)

**Goal:** all game rules work, fully tested, no UI.

### Steps

1. **Define types** (`src/engine/types.ts`)
   - `Card` (suit + rank), `Deck`, `Hand`, `PlacedCard`
   - `GamePhase`, `GameMode`, `GameState`
   - `GameEvent` discriminated union (all event types)
   - `HandRank` for poker evaluation results

2. **Poker hand evaluation** (`src/engine/poker.ts`)
   - `evaluateHand(cards: Card[]): HandRank`
   - `compareHands(a: HandRank, b: HandRank): -1 | 0 | 1`
   - Handle all rankings: royal flush → high card
   - Handle tie-breaking by kickers
   - Edge cases: ace-low straight (A-2-3-4-5), ace as high/low

3. **Tests for poker evaluation** — every rank, kicker tie-breaks, ace-low straight, all edge cases. This is the most test-dense step.

4. **Placement validation** (`src/engine/placement.ts`)
   - `getLegalHands(state: GameState, player: 'p1' | 'p2'): number[]`
   - Enforces fill-evenly constraint
   - Enforces face-down on 5th card
   - `getAutoPlaceIndex(state: GameState, player: 'p1' | 'p2'): number` — deterministic lowest legal index for timeouts

5. **Game reducer** (`src/engine/reducer.ts`)
   - `gameReducer(state: GameState, event: GameEvent): GameState`
   - Phase transitions: lobby → shuffling → placing → replace → reveal → result
   - Turn alternation, `pendingCard` management
   - Strike tracking, 3-strike forfeit
   - Timeout handling with auto-place

6. **Scoring** (`src/engine/scoring.ts`)
   - `scoreGame(hands: { p1: Hand[]; p2: Hand[] }): { p1: number; p2: number; winner: 'p1' | 'p2' | 'draw' }`
   - Ties = 0 points

7. **Tests for reducer** — placement constraint enforced, illegal moves rejected, phase transitions correct, timeout and strikes, full game playthrough (feed a sequence of events, assert final state).

8. **Tests for scoring** — various matchup results, ties, draws.

### Deliverable
`npm test` passes with comprehensive coverage of all game rules. No UI, no Firebase.

---

## Phase 3 — AI Opponent

**Goal:** computer player that makes legal, reasonable moves.

### Steps

1. **Hand-strength projection** (`src/ai/evaluate.ts`)
   - `projectHandStrength(currentCards: Card[], newCard: Card): number`
   - Scores how much a card improves a partial hand
   - Factors: pairs, flush potential (suit matches), straight potential (sequential), three/four of a kind

2. **AI placement logic** (`src/ai/opponent.ts`)
   - `chooseHandIndex(state: GameState, card: Card): number`
   - For each legal hand: project strength with this card added
   - Pick highest improvement; tie-break by fewer cards
   - `chooseReplacement(state: GameState, card: Card): { handIndex: number; swap: boolean }`
   - For replace phase: evaluate if drawn card improves any hand by swapping a face-down card

3. **Tests for AI**
   - Always returns a legal hand index
   - Places a card that makes a pair on the hand with a matching rank (not an empty hand)
   - Replace logic: swaps when drawn card is strictly better

### Deliverable
AI produces valid, sensible placements. Tested without a browser.

---

## Phase 4 — Solo Mode UI

**Goal:** playable solo game in the browser, full UX.

### Steps

1. **Card component** (`src/ui/components/Card.tsx`)
   - Three states: face-up (shows suit + rank), face-down (shows card back with "hidden" indicator for your own), unknown (card back for opponent's)
   - Hover/long-press enlarges (CSS transform + scale, touch event handling)
   - Tailwind styling, responsive sizing

2. **Hand component** (`src/ui/components/Hand.tsx`)
   - Row of 0-5 cards
   - Drop target zone for @dnd-kit
   - Visual states: legal target (highlighted), illegal (muted), normal

3. **Board component** (`src/ui/components/Board.tsx`)
   - Opponent's 5 hands (top, compact)
   - Center strip (deck, turn indicator)
   - Your 5 hands (bottom, expanded, interactive)

4. **Drag and drop integration** (`src/ui/hooks/useDragPlacement.ts`)
   - @dnd-kit DndContext wrapping the board
   - DrawnCard as draggable
   - Legal hands as droppable targets
   - Snap-back on illegal drop
   - Move card between hands (tentative placement)

5. **Drawn card staging area** (`src/ui/components/DrawnCard.tsx`)
   - Shows the drawn card waiting to be placed
   - Draggable source

6. **Deck component** (`src/ui/components/Deck.tsx`)
   - Visual draw pile with card count
   - Click/tap to draw (in solo, triggers draw immediately)

7. **End Turn button and action bar**
   - Enabled only when pendingCard has been placed
   - Publishes END_TURN event (local dispatch in solo mode)

8. **Solo game hook** (`src/ui/hooks/useGame.ts` — solo branch)
   - Initializes GameState with mode: 'solo'
   - Shuffles deck locally
   - Dispatches events through reducer
   - On AI turn: calls `chooseHandIndex`, applies with brief delay (animation)

9. **Turn indicator and timer** (`src/ui/components/Timer.tsx`)
   - "Your turn" / "Opponent thinking..." text
   - Timer display (optional for solo — implement the component, wire up in multiplayer)

10. **Reveal animation** (`src/ui/components/RevealSequence.tsx`)
    - Hand-by-hand reveal: flip face-down cards one at a time
    - Show both hands side by side with rank label
    - Highlight winner of each matchup
    - Tally animation at the end

11. **Result overlay** (`src/ui/components/ResultOverlay.tsx`)
    - Final score, who won
    - "Play Again" / "Home" buttons

12. **Home screen** (`src/ui/screens/HomeScreen.tsx`)
    - "Play Solo" button → navigates to `/solo`
    - "Create Room" / "Join Room" buttons (disabled/placeholder for now)

13. **Mobile responsiveness**
    - Test on mobile viewport (375px portrait)
    - Cards scale down, hands stack or scroll
    - Drag and drop works with touch

### Deliverable
Full solo game playable in the browser. Draw cards, drag and drop to place, AI plays its turns, reveal sequence, play again. Mobile-friendly.

---

## Phase 5 — Crypto Layer

**Goal:** commit-reveal protocol ready to plug into multiplayer.

### Steps

1. **Seeded PRNG** (`src/crypto/shuffle.ts`)
   - `createPRNG(seed: Uint8Array): () => number` — deterministic xorshift128
   - `shuffleDeck(seed: Uint8Array): Card[]` — Fisher-Yates with seeded PRNG
   - `generateDrawOrder(seed: Uint8Array): number[]` — permutation of [0..51]

2. **Commitment functions** (`src/crypto/commitment.ts`)
   - `commit(value: string, salt: Uint8Array): Promise<string>` — SHA-256 hex
   - `verify(value: string, salt: Uint8Array, commitment: string): Promise<boolean>`
   - `generateSalt(): Uint8Array` — crypto.getRandomValues
   - `generateSeed(): Uint8Array`

3. **Protocol orchestration** (`src/crypto/protocol.ts`)
   - `generateDealerCommitments(seed): { deck, commitments, salts }`
   - `generateSelectorCommitments(seed): { drawOrder, commitments, salts }`
   - `revealDraw(drawIndex, selectorState): { position, salt }` — selector reveals
   - `revealCard(position, dealerState): { card, salt }` — dealer reveals
   - `verifyDraw(reveal, commitment): boolean`
   - `verifyCard(reveal, commitment): boolean`

4. **Seed persistence** — helper to save/load seed from localStorage keyed by `roomId:gameNumber`

5. **Tests**
   - Determinism: same seed = same deck = same commitments
   - Tamper detection: wrong card or salt fails verification
   - Full round-trip: commit → reveal → verify for 52 cards
   - Draw order: all positions covered, no duplicates

### Deliverable
Crypto module fully tested. Ready to integrate with Firebase sync.

---

## Phase 6 — Firebase Integration

**Goal:** two browsers can connect to a room and synchronize events.

### Steps

1. **Firebase setup in the app** (`src/net/firebase.ts`)
   - Initialize Firebase from env vars
   - Anonymous Auth sign-in on app load

2. **Room management** (`src/net/room.ts`)
   - `createRoom(nick, password): roomId` — generates short room code, writes meta + seats.p1, sets presence
   - `joinRoom(roomId, nick, password): void` — verifies password hash, writes seats.p2, sets presence
   - `generateRoomId(): string` — short alphanumeric (6 chars)
   - `hashPassword(password, roomId): string`

3. **Event sync** (`src/net/sync.ts`)
   - `subscribeToEvents(roomId, callback)` — `onChildAdded` on `/rooms/{roomId}/events`
   - `publishEvent(roomId, event)` — append at next seq index
   - `subscribeToPresence(roomId, callback)` — watch presence node
   - `setupPresence(roomId, player)` — `onDisconnect` handler

4. **Firebase security rules** (`database.rules.json`)
   - Only authenticated users can read/write
   - Room creation: anyone can create
   - Room joining: only if seats.p2 is empty AND password hash matches
   - Events: only seated players, only at next seq, only on their turn
   - TIMEOUT: only the non-active player can write
   - Presence: each player can only write their own
   - Timestamps: must use `ServerValue.TIMESTAMP`

5. **Lobby screen** (`src/ui/screens/LobbyScreen.tsx`)
   - Shows room code and "share this with your friend" text
   - Displays when opponent joins
   - Nickname input for both players
   - "Start Game" transitions to shuffling phase

6. **Security rules tests** — run against Firebase Emulator

### Deliverable
Two browser tabs can create a room, join with password, and see each other's presence. Event publishing/subscribing works. Security rules tested.

---

## Phase 7 — Multiplayer Game Loop

**Goal:** full multiplayer game, end to end.

### Steps

1. **Wire useGame hook for multiplayer** (`src/ui/hooks/useGame.ts` — multiplayer branch)
   - On mount: subscribe to events, replay through reducer
   - On local action: publish event to Firebase, optimistically apply
   - Handle opponent events: validate and apply through reducer

2. **Integrate commit-reveal protocol**
   - Shuffling phase: generate commitments, publish to RTDB, wait for opponent's
   - Drawing: on each turn, perform the reveal exchange via events
   - Face-down exception: dealer skips card reveal, publishes placement commitment instead
   - Reveal phase: publish card + salt for each face-down card, verify opponent's

3. **Turn timer** (`src/ui/hooks/useTimer.ts`)
   - Reads `turnStartedAt` from RTDB (server timestamp)
   - Counts down from 60s
   - On expiry: if it's opponent's turn, write TIMEOUT event

4. **Strike indicator** (`src/ui/components/StrikeIndicator.tsx`)
   - Visual dots showing strikes for each player

5. **Disconnect overlay** (`src/ui/components/DisconnectOverlay.tsx`)
   - Watches opponent presence
   - Shows countdown ("Opponent reconnecting… 0:47")
   - After 60s: "Claim win" button

6. **Rematch flow**
   - Result overlay: "Rematch" / "Leave" buttons
   - Rematch writes to `/rooms/{roomId}/rematch/pX`
   - When both true: increment `gameNumber`, alternate dealer role, clear events, restart

7. **Session score** — read/update `/rooms/{roomId}/score` on game end

8. **Refresh recovery**
   - On mount: detect existing room from URL
   - Re-authenticate (Anonymous Auth persists UID)
   - Re-read events, replay reducer
   - Re-derive crypto state from localStorage seed
   - Resume game

9. **Protocol violation handling**
   - On invalid event from opponent: show "Protocol error" screen
   - "Leave" button returns to home

### Deliverable
Two players can play a full game: create room, share code, join, draw cards, place, reveal, see winner, rematch. Handles disconnects, timeouts, refresh.

---

## Phase 8 — PWA & Deployment

**Goal:** installable app, deployed to Firebase Hosting.

### Steps

1. **PWA setup**
   - Install `vite-plugin-pwa`
   - Configure `manifest.json`: name, short_name, display: standalone, theme_color, icons
   - Service worker: precache app shell, no runtime caching
   - Install prompt component on HomeScreen

2. **Create app icons** — 192px and 512px PNG icons for manifest

3. **Firebase Hosting setup**
   - `firebase init hosting` — set public dir to `dist`, configure SPA rewrites
   - `firebase.json` includes security rules deployment

4. **Build and deploy**
   ```bash
   npm run build
   firebase deploy
   ```

5. **Test PWA**
   - Install on mobile (Add to Home Screen)
   - Verify standalone mode (no browser bar)
   - Verify app loads from cache on next open
   - Verify game works end-to-end on deployed version

6. **Push to GitHub** — developer's private account

### Deliverable
App deployed at `<project>.web.app`, installable as PWA, playable on mobile and desktop.

---

## Phase 9 — Polish & Edge Cases

**Goal:** production-ready quality.

### Steps

1. **Card animations** — flip animation (Tailwind keyframes), draw animation, placement slide
2. **Reveal sequence polish** — timing, highlight effects, hand rank labels
3. **Sound effects** (optional) — card draw, card place, win/lose
4. **Loading states** — spinner during room creation, "Waiting for opponent" in lobby
5. **Error messages** — friendly messages for wrong password, room full, room not found
6. **Mobile touch polish** — long-press card enlarge, drag sensitivity tuning, viewport meta tag
7. **Cross-browser testing** — Chrome, Safari (iOS), Firefox
8. **Accessibility basics** — focusable cards, ARIA labels on game elements, keyboard navigation for End Turn

### Deliverable
Polished, playable game ready to share with friends.

---

## Phase Summary

| Phase | What | Depends On | Key Output |
|-------|------|-----------|------------|
| 1 | Scaffolding | — | App builds and runs |
| 2 | Engine | 1 | All game rules tested |
| 3 | AI | 2 | Computer player tested |
| 4 | Solo UI | 2, 3 | Playable solo game in browser |
| 5 | Crypto | 2 | Commit-reveal protocol tested |
| 6 | Firebase | 1 | Room sync and security rules working |
| 7 | Multiplayer | 4, 5, 6 | Full multiplayer game working |
| 8 | PWA + Deploy | 7 | Live, installable app |
| 9 | Polish | 8 | Production-ready |

**Phases 5 and 6 can be developed in parallel** after Phase 4 is complete.

---

## Knowledge Graph (graphify)

This repo is also the developer's proof-of-concept for [graphify](https://github.com/safishamsi/graphify):
a tool that turns the codebase + docs into a persistent, queryable knowledge graph
(god nodes, community detection, cross-file relationships).
I would like to learn how does claude uses it, and how can I use it. For instance, query flows (i.e useMultiplayerGame), and any other type of queries/usages.

### Outputs

`graphify-out/` (committed) holds:

- `graph.html` — interactive graph, open in any browser
- `GRAPH_REPORT.md` — audit report: god nodes, surprising connections, knowledge gaps
- `graph.json` — raw graph data for `graphify query` / `path` / `explain`

### Working with it

- Codebase questions: `graphify query "<question>"` before grep — returns a scoped
  subgraph, usually much smaller than raw source browsing.
- Relationships: `graphify path "<A>" "<B>"`. Focused concept: `graphify explain "<X>"`.
- After changing code: `graphify update .` (AST-only, no LLM cost) to keep the graph
  current. Doc/spec changes need a fuller `/graphify --update`.
- The project is wired for always-on use: `.claude/settings.json` PreToolUse hooks and a
  `## graphify` section in `CLAUDE.md` steer Claude Code to the graph automatically.

### POC question to validate against

The first build (313 nodes, 16 communities) surfaced this as the single question the
graph is uniquely positioned to answer — use it to sanity-check that graphify's
cross-community bridges match reality as the app grows:

> **Why does `chinese-poker-spec-v2` connect the "Layering Architecture & Crypto Design"
> community to both "Implementation Plan Roadmap" and "CLAUDE.md Project Conventions"?**
>
> (The spec is a high-betweenness bridge node — it is the shared source that the strict
> `engine → ai → crypto → net → ui` layering, this plan's phase order, and the CLAUDE.md
> rules all derive from. If a future build breaks that bridge, the three views of the
> architecture have drifted apart.)

---

## Notes for AI Assistants Picking This Up

- **Read the spec first** (`chinese-poker-spec-v2.md`) — it has all design decisions and rationale.
- **The engine is the foundation.** Build and test it thoroughly before touching UI or Firebase. Everything else depends on it.
- **Solo mode is the integration test for the engine + UI.** Get it working before adding multiplayer complexity.
- **Firebase config:** the developer already has a Firebase project but may need to enable Anonymous Auth and RTDB. The `.env.example` file documents required keys.
- **GitHub:** push to the developer's **private** GitHub account, not a workplace org.
- **The game rules need further clarification** from the developer during implementation, especially: exact replacement phase mechanics (can you choose NOT to replace? can you see the drawn card before deciding?), and how the reveal sequence is paced (auto-advance or click-through?).
- **UI details** (colors, card design, exact animations) will be refined during implementation — the developer will provide direction.
