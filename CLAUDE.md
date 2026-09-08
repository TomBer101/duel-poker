# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Package manager is **pnpm** (the implementation plan in `docs/` says `npm` — ignore that; the repo uses pnpm and a `pnpm-lock.yaml`).

| Task | Command |
|------|---------|
| Dev server | `pnpm dev` (Vite, http://localhost:5173) |
| Run all tests | `pnpm test` (Vitest, single run) |
| Watch tests | `pnpm test:watch` |
| One test file | `pnpm test src/engine/poker.test.ts` |
| One test by name | `pnpm test -t "ace-low straight"` |
| Typecheck | `pnpm exec tsc -b` (also part of `pnpm build`) |
| Lint | `pnpm lint` |
| Production build | `pnpm build` |

### Test toolchain caveat (Windows Smart App Control)

This machine enforces Windows Smart App Control, which blocks the unsigned native
`rolldown` binary that Vite 8 / Vitest 4 ship. Accommodations that make tooling work:

- `@rolldown/binding-wasm32-wasi` is a devDependency — the WASM fallback engine.
- **`vitest.config.ts` is deliberately separate from `vite.config.ts`.** It loads
  `@vitejs/plugin-react` for the JSX transform that component tests need, runs
  `environment: "jsdom"`, and wires `src/test/setup.ts` (jest-dom matchers).
  Tailwind is intentionally **not** loaded there — tests never assert on generated
  CSS. Do **not** move `test:` into `vite.config.ts`; that pulls the Tailwind
  plugin into Vitest's config load.
- Historical note: the Tailwind/React plugins once crashed Vitest's config
  bundler here (hence an earlier plugin-free `environment: "node"` setup). That no
  longer reproduces on the current Vite/Vitest. If it regresses, the fallback is a
  plugin-free config with `esbuild: { jsx: "automatic", jsxImportSource: "react" }`
  — the JSX transform without any plugin.

## Architecture

A 2-player Chinese Poker PWA. No backend — multiplayer clients sync through Firebase
Realtime Database as a dumb JSON store. Full design in `docs/chinese-poker-spec-v2.md`;
phased build order in `docs/chinese-poker-implementation-plan.md`.

### Layering (strict dependency direction)

```
engine/  →  (nothing)         pure functions + plain data, no React, no Firebase
ai/      →  engine            pure opponent logic
crypto/  →  engine            commit-reveal, seeded PRNG (multiplayer anti-cheat)
net/     →  engine, crypto    the ONLY place Firebase is imported
ui/      →  all of the above  React components + hooks
```

Only `engine/` currently exists (branch `engine-foundation`). Keep the direction intact:
if `engine/` seems to need something from a higher layer, the design is wrong.

### Event sourcing is the core idea

`GameState` is derived state. The source of truth is an append-only log of `GameEvent`s
replayed through `gameReducer(state, event)` (`src/engine/reducer.ts`). Both multiplayer
clients replay the same log and get identical state; refresh recovery = re-read log +
replay. Consequences that constrain all engine work:

- **Every `GameEvent` must be self-contained** — it carries everything needed to replay
  with zero external lookup. The drawn `Card` travels on `DRAW` / `TIMEOUT` /
  `REPLACE_DRAW` events. `GameState` holds only a `drawCount`, never the deck: in
  multiplayer neither client has the plaintext deck, only commit-reveal hashes.
- **The reducer is pure and total.** It validates legality and throws on protocol
  violations. No I/O, no `Date.now()`, no randomness.
- **State must stay plain serializable data.** It round-trips through Firebase as JSON
  and is structurally shared between reducer steps.

### Style: functional engine, classes only where they pay off

`engine/` (and `ai/`, most of `crypto/`) are modules of pure functions over plain data —
not classes. A class here is reserved for stateful, non-serialized objects with a
lifecycle: a Firebase room client in `net/`, a seeded PRNG object in `crypto/`, an AI
opponent holding difficulty config. Prefer dependency injection by parameter / factory
function (e.g. `createRoomService({ db, auth })`) over importing singletons, so the
Firebase emulator can be swapped in for tests.

### File conventions in `engine/`

- `types.ts` — type declarations only, no runtime values.
- `constants.ts` — all constant values, including `HAND_CATEGORY` (a `const` object, not
  a TS `enum`: `tsconfig.app.json` sets `erasableSyntaxOnly`, which bans `enum` and other
  syntax that emits runtime code).
- `deck.ts` — card/deck helpers.
- `testkit.ts` — test-only helpers (`card("AH")` parser, `orderedDeck`, whole-phase
  drivers). `state.drawCount` doubles as the cursor into a test deck.

### Game rules that bite

- **Fill-evenly placement:** a card may only go on a hand that currently has the fewest
  cards (`getLegalHands`). The 5th card in any hand is forced face-down.
- **Scoring:** 5 matchups `p1.hands[i]` vs `p2.hands[i]`; matchup win = 1 point, tie = 0
  for both, so a game can end in a draw.
- **Ace is rank 14** (ace-high). The wheel (A-2-3-4-5) is a special case in
  `evaluateHand`; ranks are 2..14 (this contradicts the spec's "1 = Ace" note — the code
  wins).
- **Timeout:** deterministic auto-place on the lowest-index legal hand + a strike; 3
  strikes forfeits.

### Persistent memory

Session-to-session lessons live in
`.claude/projects/C--Users-tomer-Documents-Projects-chinese-poker/memory/` and load
automatically. Check there for prior decisions before re-deriving them.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
