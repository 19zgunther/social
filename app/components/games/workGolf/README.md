# Work Golf

Fullscreen, mobile-first low-poly mini golf for the Profile → Games tab. Built with **Three.js only** (no physics engine, no React Three Fiber). Courses are seeded **irregular islands** (Scotland-ish coasts) with fairway spines over an ocean; scores live in the shared `game_scores` table.

## Screens / flow

### Title

- **Play** — open level select
- **High Scores** — leaderboard for the currently selected / last level
- **Exit** — leave fullscreen back to Games

### Levels

- Infinite levels (`1`, `2`, `3`, …), generated from a stable seed per number
- **Unlocked:** level `1`, any level you already have a `game_scores` row for, and the next level after your highest finished round
- Score is only written when all **5 holes** on a level are completed

### Playing

- Camera follows the ball (bottom-third, horizontally centered); drag sideways to orbit
- Press the ball and drag **down** for power; while aiming, drag sideways to rotate aim (camera-forward)
- Aim HUD shows rough carry (`~Ny`) plus power %; landing ring + ghost arc preview the shot
- Long shots open an FPS-style aim bloom (spray cone + landing ellipse); release picks a random angle inside it
- Sparse floating **Beer Can** pickups: fly the ball through one for ~20s of tighter aim spray and **1.5×** shot distance
- Interactions lock while the ball is moving
- Holes are played **in order** along the fairway spine (1 → 5); only the current cup can be sunk
- Distance label shows only for the current cup; upcoming flags stay visible (dimmed) as landmarks
- A ground arrow near the ball points toward the next cup; camera faces it after each hole
- After a cup is sunk, that flag disappears and play continues toward the next hole in order
- Water hazard: ball returns to the last shot position and **+1 stroke**

### Round complete

- Shows total score, per-hole scores, strokes, run rank / personal best
- Level leaderboard with **All** / **Friends** toggle, your rank (`#N of total`), and highlighted row
- Full high-scores screen available from title / complete
- **Next Level** / **Replay** / **Title**

## Scoring

Per hole:

```text
max(0, 1000 - 50 × strokesOnHole)
```

Round score = sum of the five hole scores (higher is better — fits existing leaderboard ordering).

Every shot release counts as one stroke. Landing in water adds one extra stroke and resets to the last lie.

## Surfaces

| Surface      | Behavior                                      |
|--------------|-----------------------------------------------|
| Medium grass | Default fairway — moderate roll               |
| Tall grass   | Bounces with less run; heavy drag, stops sooner than fairway |
| Green        | Short grass near cups — fast roll             |
| Sand         | Bounces; stops short rolls (no roll-out)      |
| Water / void | Hazard — reset +1 stroke                      |
| Bounce       | Always (~20% of previous arc height)          |

## Controls (touch)

| Gesture                         | Action                                      |
|---------------------------------|---------------------------------------------|
| Drag on empty ground (L/R)      | Orbit camera / aim yaw                      |
| Press ball → drag down          | Set shot power                              |
| While aiming, drag L/R          | Adjust aim yaw (shows arc preview)          |
| Release                         | Hit (if power high enough)                  |
| Driver / Chip / Putt (left)     | Change launch loft                          |
| Zoom slider (right)             | Camera distance                             |
| Pause (II)                      | Pause menu                                  |

## Terrain / course generation

Continuous shared-vertex triangle grid on a **rugged island** over open ocean:

1. Irregular Scotland-ish outline (lobes / headlands + fjord cuts + coastal warp) with **steep dirt cliffs**
2. Mild fBm hills on the plateau; fairway spine stays inland of the cliff rim
3. Seeded **spine** polyline: tee → 5 cups with optional dogleg bends
4. Tall-grass **rough** band + flattened **fairway** corridor along the spine
5. Greens + tee pads; cups are **real carved holes** with local mesh refinement
6. Sand bunkers beside greens / dogleg insides; ponds on bend outsides (no forced carries)
7. Tree belts flanking the fairway (denser on the inside of doglegs)

A cup only counts when the ball actually drops into the opening (not a large magnetic catch radius).

## Art direction

Low-poly island look: cyan ocean, tan cliff skirts, medium fairway, taller rough, light greens, sand bunkers, low-poly pines, colored pennant flags, hard directional shadows, flat shading.

## Tech layout

| File                 | Role                                              |
|----------------------|---------------------------------------------------|
| `WorkGolfGame.tsx`   | Menus, HUD, pointer input, score submit           |
| `workGolfEngine.ts`  | Procedural levels, physics, round state             |
| `workGolfScene.ts`   | Three.js world, lights, camera, distance sprites  |
| `workGolfScores.ts`  | Client helpers for submit / leaderboard / unlocks |

Game id: `work-golf`. Level ids: `"1"`, `"2"`, …  

Unlocks use `POST /api/game-scores-played` (distinct levels for the current user).
