# Work Golf

Fullscreen, mobile-first low-poly mini golf for the Profile → Games tab. Built with **Three.js only** (no physics engine, no React Three Fiber). Courses are seeded procedural islands; scores live in the shared `game_scores` table.

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
- Interactions lock while the ball is moving
- Distance labels float above each remaining flag
- After a cup is sunk, that flag disappears and play continues from the cup toward remaining holes
- Water hazard: ball returns to the last shot position and **+1 stroke**

### Round complete

- Shows total score, per-hole scores, strokes, run rank / personal best
- Mini top-3 for that level; full leaderboard available
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
| Tall grass   | Bounces like elsewhere; stops short rolls     |
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

## Terrain

Continuous shared-vertex triangle grid (no torn cell skirts):

1. Seed a regular heightfield
2. Distort with a few octaves of value-noise fBm
3. Soft island mask slopes into the water plane
4. Flatten tee, greens, and fairway corridors
5. Water hazards depress the mesh under the waterline (verts stay welded)

## Tech layout

| File                 | Role                                              |
|----------------------|---------------------------------------------------|
| `WorkGolfGame.tsx`   | Menus, HUD, pointer input, score submit           |
| `workGolfEngine.ts`  | Procedural levels, physics, round state             |
| `workGolfScene.ts`   | Three.js world, lights, camera, distance sprites  |
| `workGolfScores.ts`  | Client helpers for submit / leaderboard / unlocks |

Game id: `work-golf`. Level ids: `"1"`, `"2"`, …  

Unlocks use `POST /api/game-scores-played` (distinct levels for the current user).

## Art direction

Match the reference island look: cyan water void, medium green fairway, lighter greens, sand bunkers, tan cliff skirts, low-poly pine cones, colored pennant flags, hard directional shadows, flat shading.
