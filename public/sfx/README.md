# Sound effects

Drop real audio files here with these exact names. They are served at
`/sfx/<name>.<ext>` (Vite copies `public/` verbatim — no import, no rebuild of
code needed, just replace the file).

`useSfx` tries `.mp3` first, then `.ogg` and `.wav` as fallbacks, so any one
format is enough. Keep them short and small (< 100 KB); mono is fine.

| File | Trigger | Notes |
|------|---------|-------|
| `card-draw`  | a card is drawn from the deck (`DRAW` / `REPLACE_DRAW`) | one-shot |
| `card-place` | a card is committed to a hand (`END_TURN` / `REPLACE`) | one-shot |
| `card-flip`  | a face-down card flips during the reveal sequence | one-shot |
| `tick`       | plays on a loop during the last 5 s of the turn timer | should loop seamlessly (~1 s) |
| `time-up`    | the turn timer hits 0 | one-shot |
| `win`        | result overlay, local player won | one-shot |
| `lose`       | result overlay, local player lost | one-shot |
| `draw-game`  | result overlay, game tied | one-shot |

The current files are **0-byte placeholders** so nothing 404s. Missing/empty
files fail silently — the game plays fine with no sound.
