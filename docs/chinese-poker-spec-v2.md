# Chinese Poker — Online Multiplayer Web App

## Full Design Specification

**Date:** 2026-08-05
**Status:** Approved design, ready for implementation

---

## 1. Project Overview

A two-player online Chinese Poker card game, built as an installable PWA (React + Vite + TypeScript + Tailwind). No backend server — two browsers synchronize through Firebase Realtime Database. Free-tier infrastructure only.

**Repository:** hosted on the developer's **private GitHub account** (not workplace org).

### What the Game Is

- 2 players, 1 shared deck of 52 cards — **the whole deck is used**: 50 cards fill the 10 hands (5 hands × 5 cards × 2 players), and the 2 that remain are exactly the one replacement card each player draws in the replace phase below
- **Opening deal:** before any turn-by-turn drawing, each player is dealt one face-up card into each of their 5 hands (10 cards total, 5 per player) — every hand starts at 1 card instead of empty
- Players then take turns drawing one card from the deck and placing it into one of their 5 hands, same as before, until every hand holds 5 (1 dealt + 4 drawn each)
- **Placement constraint:** a player cannot add the (i+1)-th card to any hand until ALL 5 hands have i cards (fill evenly, player chooses order within each round) — the opening deal itself satisfies this by giving every hand exactly 1 card at once
- Cards 1–4 in each hand are placed **face-up** (visible to opponent)
- The 5th card in each hand **must** be placed **face-down** (hidden until reveal)
- After all hands are filled (25 cards each), each player may **replace** one face-down card with the next card drawn from the deck
- Then: **reveal phase** — hands are compared one-by-one: `p1.hands[i]` vs `p2.hands[i]` (5 matchups)
- Each matchup scored by standard poker hand rankings
- **Winner** = player who won more of the 5 matchups. Ties in a matchup = 0 points for both
- **Two game modes:** online multiplayer (vs friend) and solo (vs computer)

### Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | React 19 + Vite + TypeScript |
| Styling | Tailwind CSS |
| Drag & Drop | @dnd-kit |
| Transport | Firebase Realtime Database (free Spark plan) |
| Auth | Firebase Anonymous Auth (invisible to users) |
| Hosting | Firebase Hosting (free tier, HTTPS) |
| PWA | vite-plugin-pwa |
| Testing | Vitest + Firebase Emulator |
| Crypto | Web Crypto API (native SHA-256, getRandomValues) |

---

## 2. Architecture

### System Diagram (Multiplayer)

```
┌──────────────┐         ┌─────────────────────┐         ┌──────────────┐
│  Player 1     │ ⇄ sync │  Firebase RTDB       │ sync ⇄ │  Player 2     │
│  React PWA    │        │  /rooms/{roomId}     │        │  React PWA    │
│  (full logic) │        │  (dumb JSON store +  │        │  (full logic) │
└──────────────┘         │   security rules)    │        └──────────────┘
                         └─────────────────────┘
```

### System Diagram (Solo Mode)

```
┌──────────────────────────┐
│  Player's Browser         │
│  ┌──────────┐ ┌────────┐ │
│  │ React UI │→│ Engine │ │   No Firebase. No crypto.
│  │          │←│ + AI   │ │   All local. Instant turns.
│  └──────────┘ └────────┘ │
└──────────────────────────┘
```

- **Multiplayer:** No server-side logic. Firebase is a dumb synchronized JSON store with security rules. Every game action is an event appended to the room's event log. Both clients replay events through the same pure reducer → identical game state.
- **Solo:** Same engine/reducer, but events are generated locally. AI produces placement decisions via a simple heuristic function. No networking, no crypto, no Firebase.

### Project Structure

```
src/
  engine/        ← Pure TypeScript, zero dependencies, no React, no Firebase
    reducer.ts       Game state reducer (phase transitions, turn logic)
    poker.ts         Hand evaluation & comparison
    placement.ts     Placement validation rules
    scoring.ts       Matchup scoring & session score
    types.ts         GameState, GameEvent, Hand, Card, etc.

  ai/            ← Pure TypeScript, zero dependencies
    opponent.ts      AI placement logic: (gameState, drawnCard) → handIndex
    evaluate.ts      Hand-strength projection helpers

  crypto/        ← Pure TypeScript, zero dependencies
    commitment.ts    SHA-256 commitments, reveal verification
    shuffle.ts       Seeded PRNG, Fisher-Yates, permutation generation
    protocol.ts      Orchestrates commit-reveal phases

  net/           ← Firebase adapter (ONLY place Firebase is imported)
    firebase.ts      Firebase app init, config from env vars
    room.ts          Room CRUD, join/leave, password check
    sync.ts          Event publishing, subscribing, presence (onDisconnect)
    rules.ts         Security rules helpers / types

  ui/            ← React components and hooks
    screens/
      HomeScreen.tsx       Create/join room OR start solo game
      LobbyScreen.tsx      Waiting for opponent, share room code
      GameScreen.tsx       Main gameplay (includes reveal & result as overlays)
    components/
      Board.tsx            Opponent hands + your hands layout
      Hand.tsx             Single hand (row of cards)
      Card.tsx             Individual card (face-up, face-down, back states)
      Deck.tsx             Draw pile
      DrawnCard.tsx        The card waiting to be placed (draggable)
      DropTarget.tsx       Legal hand indicator for drag-and-drop
      Timer.tsx            Turn countdown (60s)
      StrikeIndicator.tsx  Strike dots (●●○)
      DisconnectOverlay.tsx  "Waiting for opponent… 0:47"
      RevealSequence.tsx   Hand-by-hand reveal animation
      ResultOverlay.tsx    Final scores, rematch/leave
      InstallPrompt.tsx    PWA install banner
    hooks/
      useGame.ts           Connects reducer to Firebase sync (multiplayer) or local AI loop (solo)
      usePresence.ts       Opponent online/offline state (multiplayer only)
      useDragPlacement.ts  @dnd-kit integration for card placement
      useTimer.ts          Turn timer based on server timestamp
      usePWAInstall.ts     beforeinstallprompt handler
```

### Key Architectural Decisions

- **Event sourcing:** the `events` log in RTDB is the single source of truth. All other state (phase, turn, board) is derived by replaying events through the reducer. This makes refresh recovery trivial: reload → read events → replay → resume.
- **Pure engine:** `src/engine/` has zero external dependencies. All game rules, validation, and poker evaluation are pure functions. Testable without a browser.
- **Firebase isolation:** only `src/net/` imports Firebase. If the transport changes later, only one folder is affected.
- **AI isolation:** `src/ai/` depends only on `src/engine/` types. The AI is a pure function with no side effects.

---

## 3. Solo Mode — vs Computer

### Why It's Lightweight

Solo mode reuses the entire engine (reducer, placement rules, poker evaluation, scoring). It strips out everything multiplayer-specific:

| Multiplayer Layer | Solo Equivalent |
|-------------------|----------------|
| Firebase RTDB sync | Local event dispatch (direct reducer calls) |
| Commit-reveal crypto | Standard `Math.random` or `crypto.getRandomValues` shuffle — no adversary to cheat |
| Presence / disconnect | N/A |
| Turn timer | Optional (can keep it for practice, or disable) |
| Security rules | N/A |

### AI Logic (`src/ai/opponent.ts`)

A single pure function: `chooseHandIndex(gameState: GameState, card: Card): number`

**v1 heuristic — "greedy best fit":**

For each legal hand (where placement is allowed per the fill-evenly rule):
1. Project what the hand would look like with this card added
2. Score the partial hand's **potential** — how close it is to forming a strong poker hand:
   - Does this card make a pair with an existing card? (+)
   - Does it contribute to a flush (same suit as others in hand)? (+)
   - Does it contribute to a straight (sequential with others)? (+)
   - Does it add to three-of-a-kind / four-of-a-kind? (++)
3. Place the card in the hand with the highest improvement score
4. Tie-break: prefer the hand with fewer cards (spread the strength)

This is intentionally simple — not game-theory optimal, just "feels like a reasonable opponent." It doesn't bluff, plan ahead across hands, or consider what the human is building. Good enough to practice against and understand the game.

### AI Turn Flow

1. Deck is shuffled locally (plain Fisher-Yates, no commit-reveal)
2. Human draws → places → End Turn (same drag-and-drop UX as multiplayer)
3. AI draws → instant placement via `chooseHandIndex()` → short animation delay (500ms–1s so the human can see what happened) → human's turn
4. No turn timer on AI (it "plays" instantly). Human can optionally have a timer or not (TBD — could be a setting).
5. Replace phase: AI uses same heuristic to decide whether to swap a face-down card
6. Reveal: same hand-by-hand reveal animation

### What Changes in the UI

- **HomeScreen** gets a "Play Solo" button alongside "Create Room" / "Join Room"
- **GameScreen** works identically — same board, same drag-and-drop. The opponent area shows the AI's hands (face-up cards visible, face-down hidden as card backs).
- **No lobby screen** for solo — game starts immediately after clicking "Play Solo"
- **Result overlay** shows "Play Again" instead of "Rematch" (no need for both sides to agree)
- **No disconnect overlay, no presence indicators** in solo mode

### Solo Data Flow

```
HomeScreen → "Play Solo"
  → shuffle deck locally
  → initialize GameState via reducer
  → alternate: human turn (drag-and-drop → END_TURN) / AI turn (chooseHandIndex → END_TURN)
  → replace phase
  → reveal
  → "Play Again" or "Home"
```

No Firebase, no localStorage persistence (refreshing a solo game just restarts — acceptable for v1), no session score tracking (could add later if wanted).

---

## 4. Firebase Setup

### One-Time Console Setup (free Spark plan, no credit card)

1. Create a Firebase project at console.firebase.google.com
2. Enable **Anonymous** sign-in (Authentication → Sign-in method)
3. Create a **Realtime Database** (pick closest region)
4. Register a **Web app** in project settings → copy config snippet

### Config in Code

Firebase config values go into `.env.local`:
```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_DATABASE_URL=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

These values are **not secrets** — every Firebase web app ships them to the browser. Protection comes from security rules + Anonymous Auth. The repo includes `.env.example` documenting the required keys.

### Deployment

`firebase deploy` from CLI deploys both the built React app (to Hosting) and the security rules file (from repo). Rules are version-controlled, not console-edited.

---

## 5. RTDB Data Model

```
/rooms/{roomId}
  meta:
    createdAt:      <server timestamp>
    passwordHash:   "<sha256(password + roomId)>"
    status:         "waiting" | "playing" | "finished"
    phase:          "lobby" | "shuffling" | "placing" | "replace" | "reveal" | "result"
    turn:           "p1" | "p2"
    turnStartedAt:  <server timestamp>
    gameNumber:     1                    // increments each rematch
    dealerRole:     "p1" | "p2"          // alternates each rematch

  seats:
    p1: { uid: "<firebase uid>", nick: "Tomer", strikes: 0 }
    p2: { uid: "<firebase uid>", nick: "Dana",  strikes: 1 }

  score:                                 // running session score (survives rematches)
    p1: 2
    p2: 1

  presence:                              // maintained via onDisconnect
    p1: { online: true,  lastSeen: <ts> }
    p2: { online: false, lastSeen: <ts> }

  commitments:                           // published once at game start
    dealer: [<52 card commitment hashes>]
    selector: [<52 draw-order commitment hashes>]

  events:                                // append-only game log — THE source of truth
    0: { seq: 0, by: "p1", type: "COMMIT",       payload: {...}, at: <ts> }
    1: { seq: 1, by: "p2", type: "COMMIT",       payload: {...}, at: <ts> }
    2: { seq: 2, by: "p1", type: "DRAW_REVEAL",  payload: {...}, at: <ts> }
    3: { seq: 3, by: "p1", type: "END_TURN",     payload: { handIndex, faceDown }, at: <ts> }
    ...

  rematch:
    p1: true
    p2: false
```

### Data Model Decisions

- **`events` is the source of truth; `meta` fields are a denormalized cache.** Each client recomputes state by replaying `events`. Security rules trust the event log, not the mirror.
- **Integer `seq` keys** (not Firebase push IDs) for strict ordering, gap detection, and security rule enforcement ("only append at next index, only on your turn").
- **Face-down cards are NOT stored as plaintext.** Stored as commitments during play; revealed in the reveal phase.
- **`passwordHash`** not `password` — SHA-256 with roomId as salt. Low-value secret, just gates one ephemeral room.
- **No per-move private data in RTDB.** Secret seeds stay in `localStorage`.

---

## 6. Commit-Reveal Anti-Cheat Protocol

### Why This Exists

In a pure client-side multiplayer game with no server, one of the two clients would normally shuffle the deck — meaning that client could cheat by inspecting the deck order. The commit-reveal protocol makes cheating detectable and the deck fair.

**This protocol is used in multiplayer mode only.** Solo mode uses a plain local shuffle.

### Roles

Each game assigns one player as **Dealer** (shuffles the deck) and one as **Selector** (determines draw order). **Roles alternate each rematch.**

### Phase 1 — Commitment Exchange (`shuffling` phase)

1. **Dealer** generates a cryptographically random seed → derives a permutation of all 52 cards via seeded Fisher-Yates → for each position `i`, generates a random salt → publishes `commitment[i] = SHA-256(cardId || salt_i)`. Also publishes `deckRoot = SHA-256(all commitments concatenated)` as a tamper seal.

2. **Selector** generates a cryptographically random seed → derives a permutation of `[0..51]` (the draw order) → for each draw index `j`, generates salt → publishes `commitment[j] = SHA-256(drawOrder[j] || salt_j)`. Publishes `drawRoot`.

3. Both verify they see 52 commitments from the other. Game transitions to `placing`.

### Phase 2 — Drawing (each turn during `placing`)

Draw #k:
1. Selector reveals: `{ position: drawOrder[k], salt: salt_k }` — verified against selector's commitment[k]
2. Dealer reveals: `{ card: deck[position], salt }` — verified against dealer's commitment[position]
3. Card is now known. Active player places it and hits End Turn.

### Face-Down Exception

- **Dealer's turn, face-down card:** Selector reveals the position, Dealer skips the card reveal (Dealer already knows the card). Dealer places it secretly. `END_TURN` event includes a placement commitment `H(cardId || handIndex || salt)` instead of the plain card. Verified at reveal phase.
- **Selector's turn, face-down card:** Both steps happen normally — both players learn the card. **This is the known asymmetry.** Mitigated by alternating Dealer/Selector roles each rematch.

### Phase 3 — Replace Phase

Same draw mechanic. Player draws next card, optionally swaps with one face-down card. Swap published as a new commitment or plain move depending on visibility.

### Phase 4 — Reveal

Hands revealed one at a time. For each face-down card, the player publishes card + salt. Opponent verifies against placement commitment. Any failure = protocol violation, game halts.

### What Lives Where

| Data | Storage | Reason |
|------|---------|--------|
| Secret seed | `localStorage` (keyed by roomId + gameNumber) | Never touches Firebase. Re-derivable on refresh. |
| Commitments (hashes) | Firebase RTDB | Opaque to opponent. Verifiable. |
| Reveals (card + salt) | Firebase RTDB events | Published only when the protocol calls for it. |

### Crypto Primitives (all native, zero dependencies)

- `SHA-256` via `crypto.subtle.digest` (Web Crypto API)
- `crypto.getRandomValues` for seed generation
- A ~20-line seeded PRNG (e.g., 128-bit xorshift) for deterministic Fisher-Yates — needed because Web Crypto randomness isn't seedable

---

## 7. Game Engine (`src/engine/`)

### State Types

```ts
type GamePhase = 'lobby' | 'shuffling' | 'placing' | 'replace' | 'reveal' | 'result'
type GameMode = 'multiplayer' | 'solo'

type GameState = {
  mode: GameMode
  phase: GamePhase
  turn: 'p1' | 'p2'                   // p2 = AI in solo mode
  drawIndex: number                    // 0..49
  hands: {
    p1: [Hand, Hand, Hand, Hand, Hand]
    p2: [Hand, Hand, Hand, Hand, Hand]
  }
  strikes: { p1: number; p2: number }
  pendingCard: Card | null             // drawn but not yet placed
}

type Hand = {
  cards: PlacedCard[]                  // 0-5 cards
}

type PlacedCard =
  | { card: Card; faceUp: true }
  | { commitment: string; faceUp: false; card?: Card }

type GameEvent =
  | { type: 'COMMIT'; ... }
  | { type: 'DRAW_REVEAL'; ... }
  | { type: 'END_TURN'; handIndex: number; ... }
  | { type: 'REPLACE'; ... }
  | { type: 'REVEAL_HAND'; ... }
  | { type: 'TIMEOUT'; ... }
  | { type: 'REMATCH_ACCEPT'; ... }
```

### Reducer

Single pure function: `gameReducer(state: GameState, event: GameEvent): GameState`

Validates legality, applies the event, transitions phase when appropriate. Throws on protocol violations.

### Placement Rules

- `min = Math.min(...hands.map(h => h.cards.length))`
- Card can only be placed on a hand where `hand.cards.length === min`
- When `min === 4`, the card is the 5th — must be placed face-down, on any hand with exactly 4 cards

### Turn Flow

1. Protocol reveals the next card → `pendingCard` is set
2. Player drags card onto a legal hand (tentative, can move it between hands)
3. Player clicks **End Turn** → `END_TURN` event published with final placement
4. Reducer validates, applies, clears `pendingCard`, flips `turn`, resets timer
5. **Timeout (60s):** auto-place on lowest-index legal hand, increment strikes. **3 strikes = forfeit.**

### Poker Hand Evaluation

`evaluateHand(cards: Card[]): HandRank` — returns a comparable rank object.

Standard hierarchy: Royal Flush > Straight Flush > Four of a Kind > Full House > Flush > Straight > Three of a Kind > Two Pair > One Pair > High Card. Ties broken by kickers.

`compareHands(a: HandRank, b: HandRank): -1 | 0 | 1`

### Scoring

- 5 matchups: `p1.hands[i]` vs `p2.hands[i]`
- Matchup winner: 1 point. **Tie: 0 points for both.**
- Game winner: most points out of 5 (game can draw at e.g., 2-2 with 1 tie)
- Session score: running tally across rematches, incremented per game winner

---

## 8. UI Design

### Routing

| Route | Screen |
|-------|--------|
| `/` | Home — create room / join room / play solo |
| `/room/:id` | Multiplayer — lobby → game → reveal → result (all phases, one screen) |
| `/solo` | Solo game — game → reveal → result (no lobby, starts immediately) |

Navigation between phases is automatic based on `GameState.phase`. No manual URL changes needed. Routes exist so refresh lands on the right screen.

### Game Screen Layout

```
┌─────────────────────────────────┐
│  Opponent's 5 hands (compact)   │
│  [H0] [H1] [H2] [H3] [H4]     │
├─────────────────────────────────┤
│  Deck  ·  Turn indicator        │
│  Timer: 0:37  ·  Strikes: ●●○  │
├─────────────────────────────────┤
│  Your 5 hands (expanded)        │
│  [H0] [H1] [H2] [H3] [H4]     │
├─────────────────────────────────┤
│  [ End Turn ]                   │
└─────────────────────────────────┘
```

- **Mobile:** hands stack vertically and scroll, cards smaller
- **Desktop:** hands laid out horizontally
- **Solo mode:** same layout. AI's hands show face-up cards, face-down as card backs. No timer strip (or optional). No disconnect overlay.

### Interactions

- **Card placement:** drag & drop via `@dnd-kit`. Drawn card appears in a staging area → drag onto a legal hand. Legal hands show drop-target highlight, illegal hands are muted. Placement is tentative until End Turn — drag to another hand to change your mind.
- **Card inspect:** hover (desktop) or long-press (mobile) enlarges the card. Does not trigger drag.
- **Face-down cards:** your own show the value to you with a visual "hidden from opponent" indicator. Opponent's show as card backs.
- **Disconnect overlay:** "Opponent reconnecting… 0:47" — covers center strip, non-blocking. (Multiplayer only.)

### Reveal Sequence

Plays in-place on the same board. Hands flip over one at a time with animation. Each matchup shows both hands side by side, highlights winner, shows hand rank name. After all 5: final tally + session score (multiplayer) or just tally (solo).

**Multiplayer result:** Rematch / Leave buttons. Rematch requires both players.
**Solo result:** Play Again / Home buttons. Instant restart.

### Styling

- **Tailwind CSS** with `@tailwindcss/vite`
- CSS custom properties for card colors and game theme
- Tailwind config for custom animations (card flip, reveal, score tally)
- Responsive: mobile-first, portrait-oriented game layout

### PWA

- `manifest.json`: standalone display mode, theme color, icons (192px + 512px)
- Service worker via `vite-plugin-pwa`: precaches app shell only. No runtime caching of Firebase — game is online-only.
- Install prompt: subtle banner on Home screen using `beforeinstallprompt` event

---

## 9. Error Handling & Edge Cases

### Network & Presence (Multiplayer Only)

| Scenario | Behavior |
|----------|----------|
| Player disconnects mid-turn | `onDisconnect` sets presence offline. Opponent sees countdown overlay. Reconnect within 60s = resume. Otherwise opponent can claim win. |
| Player refreshes | UID persists (Anonymous Auth). Re-read events, replay reducer, re-derive crypto from localStorage seed. ~1s recovery. |
| Player closes tab permanently | Same as disconnect. 60s timeout → opponent claims win. |
| Both disconnect | Room sits idle. Cleaned up after 24h inactivity (or just ignored — dead rooms are tiny). |

### Protocol Violations (Multiplayer Only)

Game halts with "Protocol error" screen. No automatic penalty — for casual play, this means a bug. Both players get a "Leave" button.

### Turn Timer Edge Cases

| Edge Case | Resolution |
|-----------|-----------|
| Clock skew | Timers based on `turnStartedAt` from `ServerValue.TIMESTAMP`, not local clocks. |
| Opponent disconnects during your turn | Your timer keeps running. Disconnection doesn't pause the game. |
| Timeout while dragging | Drag cancelled, auto-place applies. |
| Simultaneous timeout claims | Can't happen — only the non-active player can write a TIMEOUT event (security rules). |

### Room Lifecycle

| Edge Case | Resolution |
|-----------|-----------|
| Wrong password | Client-side hash comparison. Security rules also enforce. |
| Room full | Security rules reject write to `seats.p2` if occupied. |
| Creator leaves before anyone joins | Room stays in `waiting`. Cleaned up by staleness. |
| Rejoin after forfeit | Room is `finished`. Shows result screen. Only rematch restarts. |

---

## 10. Testing Strategy

### Engine Tests (highest priority)

Vitest. Pure functions → straightforward unit tests.

- **Poker hand evaluation:** every rank, tie-breaking, edge cases (ace-low straight, etc.)
- **Reducer / placement:** fill-evenly constraint, face-down on 5th card, illegal moves rejected, turn alternation
- **Timeout / strikes:** deterministic auto-placement, 3 strikes = forfeit
- **Scoring:** matchup tallying, ties = 0 points, session score across rematches

### AI Tests

- `chooseHandIndex` picks legal hands only
- Prefers hands where the card improves the poker rank
- Deterministic given the same state (no internal randomness in placement decisions)

### Crypto Tests

- Same seed → same commitments (deterministic)
- Valid reveal passes, tampered reveal fails
- Seeded PRNG: same seed = same permutation, all 52 cards present
- Refresh recovery: seed from localStorage re-derives identical state

### Firebase Security Rules Tests

Run against Firebase Emulator (free, local).

- Only seated players can write
- Events append-only at next seq
- Only non-active player can write TIMEOUT
- Wrong password rejects join

### UI Tests (minimal for v1)

- No E2E framework. Manual two-tab testing (create room in tab 1, join in tab 2).
- Component tests only where logic is tricky (drag-and-drop validation hook, timer display).

---

## 11. Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Transport | Firebase RTDB (not WebRTC) | Works on every network (no NAT issues), simpler, free at this scale |
| Anti-cheat | Commit-reveal split shuffle (not full mental poker) | Good enough for casual play, much simpler to implement |
| Face-down asymmetry | Role alternation per rematch | Avoids heavy crypto (Diffie-Hellman key exchange), acceptable for friends |
| Player identity | Anonymous Auth (invisible, no sign-up) | Enough for security rules, no UX overhead |
| Refresh handling | Replay events from RTDB + re-derive crypto from localStorage seed | Full recovery, same device only |
| Disconnect timeout | 60 seconds | Opponent sees countdown, then can claim win |
| Turn timer | 60 seconds per turn | Committed by "End Turn" button, not on card placement |
| Timeout penalty | Auto-place + strike, 3 strikes = forfeit | Deterministic auto-place (lowest legal hand index) |
| Scoring ties | 0 points for both | No half-points |
| Post-game | Rematch in same room + running session score | Both must agree to rematch. Score persists across games. |
| Game + result screen | Single route, result as overlay | No page navigation, reveal animation in-place |
| Card placement | Drag and drop (@dnd-kit) | Tentative until End Turn |
| Card inspection | Hover/long-press enlarges | Desktop hover, mobile long-press |
| Styling | Tailwind CSS | Custom animations for card mechanics |
| PWA | Installable, cached shell, online-only | vite-plugin-pwa, no offline gameplay |
| Project structure | Single Vite app, layered modules | engine/ (pure), ai/ (pure), crypto/ (pure), net/ (Firebase), ui/ (React) |
| State management | Pure reducer (not XState) | Zero deps, same safety via TypeScript discriminated unions |
| Solo mode | Greedy best-fit heuristic AI | Lightweight, reuses entire engine, no networking |
| Repository | Developer's private GitHub account | Not workplace org |

---

## 12. Open Items for Implementation

- **Detailed UI/UX design:** card visuals, color palette, animations, mobile layout specifics — to be refined during implementation
- **Detailed game rules:** exact replacement phase mechanics, edge cases in the card swap — to be clarified with product owner
- **Firebase security rules:** exact rule definitions to be written during implementation, tested against emulator
- **Card asset design:** whether to use SVG cards, emoji, or a card sprite sheet
- **Room code format:** short alphanumeric (e.g., 6 chars) vs UUID — cosmetic but affects shareability
- **Solo turn timer:** whether to keep the 60s timer in solo mode or make it optional
- **AI difficulty levels:** v1 ships one difficulty; future versions could add harder AI that considers opponent hands and cross-hand strategy
