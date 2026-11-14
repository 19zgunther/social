export const FIELD_W = 300;
export const FIELD_H = 400;

export const PLAYER_W = 22;
export const PLAYER_H = 12;
export const PLAYER_SPEED = 140;
/** Steady hold-to-fire cadence (phone-friendly; no one-bullet lock). */
export const PLAYER_FIRE_COOLDOWN_MS = 240;
export const MAX_PLAYER_BULLETS = 3;
export const PLAYER_INVULN_MS = 1800;
export const STARTING_LIVES = 3;
export const EXPLOSION_MS = 380;
export const PLAYER_EXPLOSION_MS = 520;

export const ALIEN_COLS = 11;
export const ALIEN_ROWS = 5;
export const ALIEN_W = 16;
export const ALIEN_H = 12;
export const ALIEN_H_GAP = 8;
export const ALIEN_V_GAP = 10;

export const BULLET_W = 2;
export const BULLET_H = 8;
export const PLAYER_BULLET_SPEED = 280;
export const ALIEN_BULLET_SPEED = 120;

export const BARRIER_COUNT = 3;
export const BARRIER_COLS = 7;
export const BARRIER_ROWS = 5;
export const BARRIER_CELL = 4;

export const UFO_W = 28;
export const UFO_H = 10;
export const UFO_SPEED = 70;
export const UFO_SCORE = 150;

export type Phase = "playing" | "gameover" | "waveclear";

export type AlienKind = 0 | 1 | 2;

export type Alien = {
  col: number;
  row: number;
  kind: AlienKind;
  alive: boolean;
};

export type Bullet = {
  x: number;
  y: number;
  vy: number;
  fromPlayer: boolean;
};

export type Barrier = {
  x: number;
  y: number;
  cells: boolean[][];
};

export type Ufo = {
  x: number;
  y: number;
  vx: number;
  alive: boolean;
};

export type ExplosionKind = "alien" | "player" | "ufo";

export type Explosion = {
  x: number;
  y: number;
  age: number;
  duration: number;
  kind: ExplosionKind;
  /** Neon tint for alien pops (row color). */
  color: string;
};

const KIND_FOR_ROW: AlienKind[] = [0, 1, 1, 2, 2];
const SCORE_FOR_KIND: Record<AlienKind, number> = { 0: 40, 1: 20, 2: 10 };
const ROW_COLOR = ["#39ff14", "#1e90ff", "#ff2bd6", "#ff8a00", "#ffe600"] as const;

function emptyBarrierCells(): boolean[][] {
  const cells: boolean[][] = [];
  for (let r = 0; r < BARRIER_ROWS; r += 1) {
    const row: boolean[] = [];
    for (let c = 0; c < BARRIER_COLS; c += 1) {
      // Soften top corners / hollow bottom for classic bunker silhouette.
      const topCorner = r === 0 && (c === 0 || c === BARRIER_COLS - 1);
      const bottomGap =
        r >= BARRIER_ROWS - 2 && c >= 2 && c <= BARRIER_COLS - 3 && BARRIER_COLS >= 5;
      row.push(!(topCorner || bottomGap));
    }
    cells.push(row);
  }
  return cells;
}

function makeBarriers(): Barrier[] {
  const totalW = BARRIER_COLS * BARRIER_CELL;
  const y = FIELD_H - 78;
  const gaps = BARRIER_COUNT + 1;
  const spacing = (FIELD_W - BARRIER_COUNT * totalW) / gaps;
  const barriers: Barrier[] = [];
  for (let i = 0; i < BARRIER_COUNT; i += 1) {
    barriers.push({
      x: spacing + i * (totalW + spacing),
      y,
      cells: emptyBarrierCells(),
    });
  }
  return barriers;
}

function makeAliens(): Alien[] {
  const aliens: Alien[] = [];
  for (let row = 0; row < ALIEN_ROWS; row += 1) {
    for (let col = 0; col < ALIEN_COLS; col += 1) {
      aliens.push({
        col,
        row,
        kind: KIND_FOR_ROW[row] ?? 2,
        alive: true,
      });
    }
  }
  return aliens;
}

function rectsOverlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

export class SpaceInvadersEngine {
  phase: Phase = "playing";
  score = 0;
  lives = STARTING_LIVES;
  wave = 1;
  playerX = FIELD_W / 2 - PLAYER_W / 2;
  playerY = FIELD_H - 36;
  fireCooldown = 0;
  invulnMs = 0;
  aliens: Alien[] = [];
  formationX = 18;
  formationY = 48;
  formationDir: 1 | -1 = 1;
  stepAcc = 0;
  stepInterval = 700;
  animFrame = 0;
  bullets: Bullet[] = [];
  barriers: Barrier[] = [];
  explosions: Explosion[] = [];
  ufo: Ufo | null = null;
  ufoSpawnAcc = 0;
  nextUfoMs = 14000;
  alienFireAcc = 0;
  waveClearAcc = 0;
  hitFlashMs = 0;

  startNewGame(): void {
    this.phase = "playing";
    this.score = 0;
    this.lives = STARTING_LIVES;
    this.wave = 1;
    this.playerX = FIELD_W / 2 - PLAYER_W / 2;
    this.fireCooldown = 0;
    this.invulnMs = 0;
    this.bullets = [];
    this.explosions = [];
    this.barriers = makeBarriers();
    this.ufo = null;
    this.ufoSpawnAcc = 0;
    this.nextUfoMs = 12000 + Math.floor(Math.random() * 8000);
    this.alienFireAcc = 0;
    this.waveClearAcc = 0;
    this.hitFlashMs = 0;
    this.spawnWave(1);
  }

  private spawnExplosion(
    x: number,
    y: number,
    kind: ExplosionKind,
    color: string,
    duration = EXPLOSION_MS,
  ): void {
    this.explosions.push({ x, y, age: 0, duration, kind, color });
  }

  private spawnWave(wave: number): void {
    this.aliens = makeAliens();
    this.formationX = 18;
    this.formationY = 40 + Math.min(40, (wave - 1) * 6);
    this.formationDir = 1;
    this.stepAcc = 0;
    this.stepInterval = Math.max(180, 720 - (wave - 1) * 55);
    this.animFrame = 0;
    this.bullets = this.bullets.filter((b) => b.fromPlayer);
    this.ufo = null;
    this.phase = "playing";
    this.waveClearAcc = 0;
  }

  alienWorldPos(alien: Alien): { x: number; y: number } {
    return {
      x: this.formationX + alien.col * (ALIEN_W + ALIEN_H_GAP),
      y: this.formationY + alien.row * (ALIEN_H + ALIEN_V_GAP),
    };
  }

  aliveAliens(): Alien[] {
    return this.aliens.filter((a) => a.alive);
  }

  private aliveBounds(): { minX: number; maxX: number; maxY: number } | null {
    const alive = this.aliveAliens();
    if (alive.length === 0) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const a of alive) {
      const p = this.alienWorldPos(a);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x + ALIEN_W);
      maxY = Math.max(maxY, p.y + ALIEN_H);
    }
    return { minX, maxX, maxY };
  }

  movePlayer(dir: -1 | 0 | 1, dt: number): void {
    if (this.phase !== "playing" || dir === 0) return;
    this.playerX += dir * PLAYER_SPEED * (dt / 1000);
    this.playerX = Math.max(4, Math.min(FIELD_W - PLAYER_W - 4, this.playerX));
  }

  tryFire(): void {
    if (this.phase !== "playing") return;
    if (this.fireCooldown > 0) return;
    const playerShots = this.bullets.reduce((n, b) => n + (b.fromPlayer ? 1 : 0), 0);
    if (playerShots >= MAX_PLAYER_BULLETS) return;
    this.bullets.push({
      x: this.playerX + PLAYER_W / 2 - BULLET_W / 2,
      y: this.playerY - BULLET_H,
      vy: -PLAYER_BULLET_SPEED,
      fromPlayer: true,
    });
    this.fireCooldown = PLAYER_FIRE_COOLDOWN_MS;
  }

  private updateExplosions(dt: number): void {
    if (this.explosions.length === 0) return;
    const next: Explosion[] = [];
    for (const boom of this.explosions) {
      boom.age += dt;
      if (boom.age < boom.duration) next.push(boom);
    }
    this.explosions = next;
  }

  /** Returns true when the run just entered game over. */
  update(dt: number, moveDir: -1 | 0 | 1, wantsFire: boolean): boolean {
    if (this.phase === "gameover") {
      this.updateExplosions(dt);
      return false;
    }

    if (this.phase === "waveclear") {
      this.updateExplosions(dt);
      this.waveClearAcc += dt;
      if (this.waveClearAcc >= 900) {
        this.wave += 1;
        this.spawnWave(this.wave);
      }
      return false;
    }

    this.movePlayer(moveDir, dt);
    if (this.fireCooldown > 0) this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    if (wantsFire) this.tryFire();

    if (this.invulnMs > 0) this.invulnMs = Math.max(0, this.invulnMs - dt);
    if (this.hitFlashMs > 0) this.hitFlashMs = Math.max(0, this.hitFlashMs - dt);
    this.updateExplosions(dt);

    this.stepAcc += dt;
    const aliveCount = this.aliveAliens().length;
    const pace = this.stepInterval * (0.35 + 0.65 * (aliveCount / (ALIEN_COLS * ALIEN_ROWS)));
    if (this.stepAcc >= pace) {
      this.stepAcc = 0;
      this.stepFormation();
    }

    this.updateBullets(dt);
    this.updateUfo(dt);
    this.maybeAlienFire(dt);

    if (this.aliveAliens().length === 0) {
      this.phase = "waveclear";
      this.waveClearAcc = 0;
      this.bullets = [];
      return false;
    }

    const bounds = this.aliveBounds();
    if (bounds && bounds.maxY >= this.playerY) {
      return this.killPlayer(true);
    }

    return false;
  }

  private stepFormation(): void {
    const bounds = this.aliveBounds();
    if (!bounds) return;
    const stepX = 6;
    const nextMin = bounds.minX + this.formationDir * stepX;
    const nextMax = bounds.maxX + this.formationDir * stepX;
    if (nextMin < 6 || nextMax > FIELD_W - 6) {
      this.formationDir = this.formationDir === 1 ? -1 : 1;
      this.formationY += 12;
    } else {
      this.formationX += this.formationDir * stepX;
    }
    this.animFrame = (this.animFrame + 1) % 2;
  }

  private updateBullets(dt: number): void {
    const next: Bullet[] = [];
    for (const b of this.bullets) {
      b.y += b.vy * (dt / 1000);
      if (b.y + BULLET_H < 0 || b.y > FIELD_H) continue;

      if (this.hitBarrier(b)) continue;

      if (b.fromPlayer) {
        if (this.hitAlien(b)) continue;
        if (this.ufo?.alive && rectsOverlap(b.x, b.y, BULLET_W, BULLET_H, this.ufo.x, this.ufo.y, UFO_W, UFO_H)) {
          this.spawnExplosion(
            this.ufo.x + UFO_W / 2,
            this.ufo.y + UFO_H / 2,
            "ufo",
            "#ff1e1e",
            EXPLOSION_MS + 80,
          );
          this.ufo.alive = false;
          this.score += UFO_SCORE;
          continue;
        }
      } else if (
        this.invulnMs <= 0 &&
        rectsOverlap(b.x, b.y, BULLET_W, BULLET_H, this.playerX, this.playerY, PLAYER_W, PLAYER_H)
      ) {
        this.killPlayer(false);
        continue;
      }

      next.push(b);
    }
    this.bullets = next;
  }

  private hitAlien(b: Bullet): boolean {
    for (const a of this.aliens) {
      if (!a.alive) continue;
      const p = this.alienWorldPos(a);
      if (rectsOverlap(b.x, b.y, BULLET_W, BULLET_H, p.x, p.y, ALIEN_W, ALIEN_H)) {
        a.alive = false;
        this.score += SCORE_FOR_KIND[a.kind];
        this.spawnExplosion(
          p.x + ALIEN_W / 2,
          p.y + ALIEN_H / 2,
          "alien",
          ROW_COLOR[a.row] ?? "#ffe600",
        );
        return true;
      }
    }
    return false;
  }

  private hitBarrier(b: Bullet): boolean {
    for (const barrier of this.barriers) {
      const bw = BARRIER_COLS * BARRIER_CELL;
      const bh = BARRIER_ROWS * BARRIER_CELL;
      if (!rectsOverlap(b.x, b.y, BULLET_W, BULLET_H, barrier.x, barrier.y, bw, bh)) {
        continue;
      }
      const cx = Math.floor((b.x + BULLET_W / 2 - barrier.x) / BARRIER_CELL);
      const cy = Math.floor((b.y + BULLET_H / 2 - barrier.y) / BARRIER_CELL);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const x = cx + dx;
          const y = cy + dy;
          if (y < 0 || y >= BARRIER_ROWS || x < 0 || x >= BARRIER_COLS) continue;
          if (barrier.cells[y]![x]) {
            barrier.cells[y]![x] = false;
            return true;
          }
        }
      }
    }
    return false;
  }

  private maybeAlienFire(dt: number): void {
    this.alienFireAcc += dt;
    const interval = Math.max(210, 550 - this.wave * 20);
    if (this.alienFireAcc < interval) return;
    this.alienFireAcc = 0;
    const alive = this.aliveAliens();
    if (alive.length === 0) return;
    // Prefer lowest alien in a random column that still has units.
    const cols = new Map<number, Alien>();
    for (const a of alive) {
      const prev = cols.get(a.col);
      if (!prev || a.row > prev.row) cols.set(a.col, a);
    }
    const shooters = [...cols.values()];
    const shooter = shooters[Math.floor(Math.random() * shooters.length)];
    if (!shooter) return;
    const p = this.alienWorldPos(shooter);
    this.bullets.push({
      x: p.x + ALIEN_W / 2 - BULLET_W / 2,
      y: p.y + ALIEN_H,
      vy: ALIEN_BULLET_SPEED + this.wave * 6,
      fromPlayer: false,
    });
  }

  private updateUfo(dt: number): void {
    if (this.ufo?.alive) {
      this.ufo.x += this.ufo.vx * (dt / 1000);
      if (this.ufo.x > FIELD_W + 40 || this.ufo.x < -UFO_W - 40) {
        this.ufo.alive = false;
      }
      return;
    }
    this.ufoSpawnAcc += dt;
    if (this.ufoSpawnAcc < this.nextUfoMs) return;
    this.ufoSpawnAcc = 0;
    this.nextUfoMs = 14000 + Math.floor(Math.random() * 10000);
    const fromLeft = Math.random() < 0.5;
    this.ufo = {
      x: fromLeft ? -UFO_W : FIELD_W,
      y: 22,
      vx: fromLeft ? UFO_SPEED : -UFO_SPEED,
      alive: true,
    };
  }

  private killPlayer(instantGameOver: boolean): boolean {
    this.spawnExplosion(
      this.playerX + PLAYER_W / 2,
      this.playerY + PLAYER_H / 2,
      "player",
      "#39ff14",
      PLAYER_EXPLOSION_MS,
    );
    if (instantGameOver) {
      this.lives = 0;
      this.phase = "gameover";
      this.bullets = [];
      return true;
    }
    this.lives -= 1;
    this.hitFlashMs = 220;
    this.invulnMs = PLAYER_INVULN_MS;
    this.bullets = this.bullets.filter((b) => b.fromPlayer);
    this.playerX = FIELD_W / 2 - PLAYER_W / 2;
    if (this.lives <= 0) {
      this.phase = "gameover";
      return true;
    }
    return false;
  }
}
