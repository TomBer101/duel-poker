# TODO: multiplayer integrity hardening (deferred from Phase 7)

Phase 7 shipped functionally complete but with known cheat/robustness gaps. Deliberately
deferred; do these before treating the Firebase rules as secure or deploying them publicly.
Detail lives in the plan (`plans/2026-09-22-phase-7-multiplayer-game-loop.md`, Tasks 16 and 17).

## Before deploying `database.rules.json` (project `chinese-poker-dc569`)
- Rules are NOT deployed. Deploy with `firebase deploy --only database --project chinese-poker-dc569` (dry run first).
- Production smoke test (two real browsers): every move depends on `newData.parent().parent()` seeing the merged multi-path update; never verified outside the emulator.
- Deploying breaks any client built from `main` (it publishes DEAL/DRAW/ADVANCE_REVEAL/REMATCH events the new rules deny).

## Turn integrity (Task 16)
- Time-gate TIMEOUT in the rules (a forged TIMEOUT is currently accepted instantly).
- `meta/turn` and `meta/turnStartedAt` are freely writable (turn flips, re-stamping to stall).
- Lone `meta/eventSeq` bump DoS (tie it to a `lastEvent`); two `it.todo` in `rules.emulator.test.ts`.
- Publish-ordering residuals.

## Client integrity (Task 17)
- Dealer answers early/unverified position reveals, leaking future cards.
- Illegal `handIndex` crashes the reducer; one junk message halts the game; violation-as-loss.
- TIMEOUT outside placing stalls the intake queue.

## Found in the final review (not in the plan)
- I1: FORFEIT has no grace period in the rules (a presence blip lets a modified client win instantly); store disconnect time and require 60 s.
- I2: a client can withhold a reveal, then TIMEOUT the opponent with a card it picks (`handleTimeout` doesn't verify `event.card`).
- I3: no timeout in the replace/reveal phases; a losing player can stall forever.
- M2: multiplayer mounts a hidden solo game (`GameScreen.tsx`).
- M4: dealer's 52 committed cards are never checked to be a permutation.
- M6: `usePresence` has no leave cleanup.
- M8: seeds pile up in localStorage.
- M9: TIMEOUT `card` not cross-checked against own `pendingCard`.
- M10 (pre-existing): join password only checked client-side; `passwordHash` readable by any signed-in user.

## Known accepted
- A loser can claim a game's single score point before the winner.
- One uid can hold both seats.
- The selector's face-down cards are visible to the dealer (accepted asymmetry).
- Refresh on the result screen replays the reveal; refresh restamps nothing but both-seats-refresh-before-deal leaves game-1's first turn unstamped.
- Retry backoff in the own-hidden-timeout translation isn't enforced (`useOpponentEvents.ts`).
