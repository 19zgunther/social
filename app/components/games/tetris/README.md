# Tetris

Fullscreen, mobile-first Tetris for the Profile → Games tab. Implemented with a normal Canvas 2D context and no external game libraries. High scores are stored locally for now; a shared DB leaderboard can be added later.

## Screens / game flow

### Title (start)

Shown when the game opens (and after quitting back from pause / game over).

- **Play** — start a new game
- **High Scores** — open the high-score list
- **Controls** — show keyboard + touch control reference
- **Exit** — close fullscreen and return to the Games list

### Playing

Active gameplay: gravity drops the current piece, player moves/rotates/holds/drops, lines clear, level/speed increase. HUD shows score, level, lines, hold piece, and next queue.

### Paused

Entered via Pause (on-screen) or `P` / `Esc`.

- **Resume** — continue
- **Restart** — confirm and start a fresh game
- **Quit** — return to title

### Game Over

Triggered when a new piece cannot spawn (board topped out).

- Shows final score, level, and lines
- Notes if the run made the high-score list
- **Play Again** — new game
- **High Scores** — open list
- **Exit** — return to title (then Exit from title closes fullscreen)

### High Scores

- Top 10 local scores
- Each row: score, level, lines, date
- **Clear Scores** — wipe local list (with confirm)
- **Back** — previous screen (title or game over)

### Controls help

Static reference of keyboard and touch controls; **Back** returns to title.

## Controls

### Keyboard

| Key | Action |
|-----|--------|
| Left / Right | Move |
| Down | Soft drop (faster gravity + soft-drop points) |
| Up / X | Rotate clockwise |
| Z | Rotate counter-clockwise |
| Space | Hard drop |
| C | Hold (once per piece) |
| P / Esc | Pause / unpause (Esc on title may Exit) |

### Touch (primary for vertical mobile)

On-screen controls below the playfield:

- D-pad: left / right / soft drop
- Rotate CW / CCW
- Hard drop
- Hold
- Pause

Optional swipes on the playfield:

- Left / right → move
- Down → soft drop (or hard drop on a fast flick)
- Up → rotate CW

While the game is open, the overlay uses `DONT_SWIPE_TABS_CLASSNAME` so app tab swipe-back does not steal gestures.

## Rules / how it works

- **Board:** 10 columns × 20 visible rows (standard). Internal buffer rows above the visible area for spawn.
- **Pieces:** I, O, T, S, Z, J, L with classic shapes and distinct colors.
- **Randomizer:** 7-bag — shuffle all seven types, deal until empty, repeat.
- **Spawn:** pieces spawn centered near the top; immediate collision ⇒ game over.
- **Ghost piece:** translucent outline showing hard-drop landing position.
- **Hold:** swap current with held (or stash and deal next). Once per piece until it locks.
- **Next queue:** show the next 3 pieces.
- **Rotation:** CW/CCW with basic wall kicks (try offsets when the rotated shape overlaps walls/blocks).
- **Lock:** short lock delay after the piece lands; movement/rotation can reset it a limited number of times so mobile play stays snappy.
- **Line clears:** remove full rows; rows above shift down. Brief clear flash before removal.
- **Scoring (guideline-ish):**
  - Single / Double / Triple / Tetris: `100 / 300 / 500 / 800` × level
  - Soft drop: +1 per cell
  - Hard drop: +2 per cell
- **Level / speed:** start at level 1. Level up every **10 lines**. Gravity interval decreases each level and caps at a maximum speed so late game stays playable on mobile.

## Visuals

- One fullscreen dark surface (`100dvh` / `100vw`), portrait-first.
- Playfield drawn on a Canvas 2D context: grid, locked cells, active piece, ghost, clear flash.
- Side/top HUD on canvas: score, level, lines, hold box, next boxes.
- Menus use simple React/HTML overlay buttons over the dark canvas (accessible taps); in-game HUD stays on canvas.
- No external image/audio assets required for v1.
- No sound/music in v1.

## High scores (local only)

- **Storage key:** `social_tetris_high_scores`
- **Shape:** array of `{ score, level, lines, at }` (ISO timestamp), max **10**, sorted by score descending
- Written on game over when the run qualifies
- Cleared from the High Scores screen
- **Future:** persist to DB / shared leaderboards; keep this local path as offline fallback

## Technical notes

- Engine (`tetrisEngine.ts`) is pure state/logic — no DOM.
- Renderer (`tetrisRender.ts`) draws the board + HUD onto `CanvasRenderingContext2D`.
- React shell (`TetrisGame.tsx`) owns the game loop (`requestAnimationFrame`), input, menus, and fullscreen lifecycle.
- Scores helper (`tetrisScores.ts`) wraps `localStorage` with try/catch and SSR guards.
