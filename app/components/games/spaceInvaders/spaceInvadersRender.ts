import {
  ALIEN_H,
  ALIEN_W,
  BARRIER_CELL,
  BARRIER_COLS,
  BARRIER_ROWS,
  BULLET_H,
  BULLET_W,
  FIELD_H,
  FIELD_W,
  PLAYER_H,
  SpaceInvadersEngine,
  type AlienKind,
  type Explosion,
} from "./spaceInvadersEngine";

export type InvadersLayout = {
  canvasW: number;
  canvasH: number;
  playX: number;
  playY: number;
  scale: number;
  playW: number;
  playH: number;
};

/** Dense pseudo-random starfield seeds in field space. */
const STAR_SEED: { x: number; y: number; s: number; c: number }[] = (() => {
  const out: { x: number; y: number; s: number; c: number }[] = [];
  let seed = 0x2f6a9;
  const next = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  for (let i = 0; i < 90; i += 1) {
    out.push({
      x: next() * FIELD_W,
      y: next() * FIELD_H,
      s: next() > 0.82 ? 2 : 1,
      c: next(),
    });
  }
  return out;
})();

/** Row colors matching the reference (top → bottom). */
const ROW_COLOR = ["#39ff14", "#1e90ff", "#ff2bd6", "#ff8a00", "#ffe600"] as const;

const NEON_GREEN = "#39ff14";
const UFO_RED = "#ff1e1e";
/** Canvas cannot resolve CSS vars — use the real face name next/font loads. */
const HUD_FONT = '"Press Start 2P", monospace';

export function computeInvadersLayout(canvasW: number, canvasH: number): InvadersLayout {
  const topReserve = Math.max(64, Math.min(96, canvasH * 0.12));
  const bottomReserve = Math.max(72, Math.min(110, canvasH * 0.14));
  const sidePad = Math.max(8, Math.min(36, Math.floor(canvasW * 0.04)));
  const availableW = canvasW - sidePad * 2;
  const availableH = canvasH - topReserve - bottomReserve;
  const scale = Math.max(0.5, Math.min(availableW / FIELD_W, availableH / FIELD_H));
  const playW = FIELD_W * scale;
  const playH = FIELD_H * scale;
  const playX = Math.floor((canvasW - playW) / 2);
  const playY = Math.floor(topReserve + (availableH - playH) / 2);
  return { canvasW, canvasH, playX, playY, scale, playW, playH };
}

export function syncCanvasBackingStore(
  canvas: HTMLCanvasElement,
  dpr: number,
): { cssW: number; cssH: number } {
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (cssW <= 0 || cssH <= 0) return { cssW, cssH };
  const nextW = Math.floor(cssW * dpr);
  const nextH = Math.floor(cssH * dpr);
  if (Math.abs(canvas.width - nextW) >= 2 || Math.abs(canvas.height - nextH) >= 2) {
    canvas.width = nextW;
    canvas.height = nextH;
  }
  return { cssW, cssH };
}

function fx(layout: InvadersLayout, x: number): number {
  return layout.playX + x * layout.scale;
}

function fy(layout: InvadersLayout, y: number): number {
  return layout.playY + y * layout.scale;
}

function fs(layout: InvadersLayout, n: number): number {
  return n * layout.scale;
}

function drawPixelRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.floor(x), Math.floor(y), Math.max(1, Math.floor(w)), Math.max(1, Math.floor(h)));
}

/** Classic-ish 11×8 bitmaps (1 = lit). */
const ALIEN_SPRITES: Record<AlienKind, number[][]> = {
  0: [
    [0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0],
    [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 0, 1, 1, 1, 1, 1, 1, 1, 0, 1],
    [1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1],
    [0, 0, 0, 1, 1, 0, 1, 1, 0, 0, 0],
    [0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0],
  ],
  1: [
    [0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0],
    [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    [0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0],
    [0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 0],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 0, 1, 1, 1, 1, 1, 1, 1, 0, 1],
    [1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1],
    [0, 0, 0, 1, 1, 0, 1, 1, 0, 0, 0],
  ],
  2: [
    [0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0],
    [0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0],
    [0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0],
    [0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 0],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    [0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0],
    [1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1],
  ],
};

const ALIEN_FRAME_B: Record<AlienKind, number[][]> = {
  0: [
    [0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0],
    [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 0, 1, 1, 1, 1, 1, 1, 1, 0, 1],
    [0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0],
    [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    [0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0],
  ],
  1: [
    [0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0],
    [1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1],
    [1, 0, 1, 1, 1, 1, 1, 1, 1, 0, 1],
    [1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0],
    [0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0],
  ],
  2: [
    [0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0],
    [0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0],
    [0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0],
    [0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 0],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0],
    [0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0],
    [0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0],
  ],
};

function drawSprite(
  ctx: CanvasRenderingContext2D,
  layout: InvadersLayout,
  ox: number,
  oy: number,
  rows: number[][],
  color: string,
): void {
  const px = fs(layout, ALIEN_W / 11);
  const py = fs(layout, ALIEN_H / 8);
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r]!;
    for (let c = 0; c < row.length; c += 1) {
      if (!row[c]) continue;
      drawPixelRect(ctx, fx(layout, ox) + c * px, fy(layout, oy) + r * py, px, py, color);
    }
  }
}

function drawPlayerShipAt(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  unit: number,
  color: string,
): void {
  // Flat neon cannon — no shading
  drawPixelRect(ctx, screenX + 2 * unit, screenY + 8 * unit, 18 * unit, 4 * unit, color);
  drawPixelRect(ctx, screenX + 5 * unit, screenY + 5 * unit, 12 * unit, 3 * unit, color);
  drawPixelRect(ctx, screenX + 8 * unit, screenY + 2 * unit, 6 * unit, 3 * unit, color);
  drawPixelRect(ctx, screenX + 10 * unit, screenY + 0 * unit, 2 * unit, 2 * unit, color);
}

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  layout: InvadersLayout,
  x: number,
  y: number,
  flash: boolean,
): void {
  drawPlayerShipAt(ctx, fx(layout, x), fy(layout, y), layout.scale, flash ? "#ffffff" : NEON_GREEN);
}

function drawUfo(
  ctx: CanvasRenderingContext2D,
  layout: InvadersLayout,
  x: number,
  y: number,
): void {
  const bx = fx(layout, x);
  const by = fy(layout, y);
  const s = layout.scale;
  drawPixelRect(ctx, bx + 6 * s, by + 0 * s, 16 * s, 3 * s, UFO_RED);
  drawPixelRect(ctx, bx + 2 * s, by + 3 * s, 24 * s, 4 * s, UFO_RED);
  drawPixelRect(ctx, bx + 0 * s, by + 6 * s, 28 * s, 3 * s, UFO_RED);
  // Cockpit slits
  drawPixelRect(ctx, bx + 7 * s, by + 4 * s, 3 * s, 2 * s, "#2a0000");
  drawPixelRect(ctx, bx + 13 * s, by + 4 * s, 3 * s, 2 * s, "#2a0000");
  drawPixelRect(ctx, bx + 19 * s, by + 4 * s, 3 * s, 2 * s, "#2a0000");
}

/** 8-bit fire/pop frames — offsets in cells from center. */
const FIRE_FRAMES: { dx: number; dy: number; c: number }[][] = [
  [
    { dx: 0, dy: 0, c: 2 },
    { dx: -1, dy: 0, c: 1 },
    { dx: 1, dy: 0, c: 1 },
    { dx: 0, dy: -1, c: 1 },
    { dx: 0, dy: 1, c: 1 },
  ],
  [
    { dx: 0, dy: 0, c: 2 },
    { dx: -2, dy: -1, c: 1 },
    { dx: 2, dy: -1, c: 1 },
    { dx: -1, dy: 2, c: 0 },
    { dx: 1, dy: 2, c: 0 },
    { dx: -2, dy: 1, c: 1 },
    { dx: 2, dy: 1, c: 1 },
    { dx: 0, dy: -2, c: 2 },
  ],
  [
    { dx: -3, dy: -2, c: 1 },
    { dx: 3, dy: -2, c: 1 },
    { dx: -2, dy: 0, c: 0 },
    { dx: 2, dy: 0, c: 0 },
    { dx: -3, dy: 2, c: 2 },
    { dx: 3, dy: 2, c: 2 },
    { dx: 0, dy: -3, c: 0 },
    { dx: -1, dy: 3, c: 1 },
    { dx: 1, dy: 3, c: 1 },
    { dx: 0, dy: 1, c: 2 },
  ],
  [
    { dx: -4, dy: -3, c: 0 },
    { dx: 4, dy: -2, c: 0 },
    { dx: -3, dy: 3, c: 1 },
    { dx: 3, dy: 4, c: 1 },
    { dx: 0, dy: -4, c: 2 },
    { dx: -4, dy: 1, c: 2 },
    { dx: 4, dy: 0, c: 2 },
  ],
];

function firePalette(base: string, slot: number): string {
  if (slot === 2) return "#ffffff";
  if (slot === 1) return "#ffe600";
  return base;
}

function drawExplosion(
  ctx: CanvasRenderingContext2D,
  layout: InvadersLayout,
  boom: Explosion,
): void {
  const t = boom.age / boom.duration;
  const frame = Math.min(FIRE_FRAMES.length - 1, Math.floor(t * FIRE_FRAMES.length));
  const cells = FIRE_FRAMES[frame]!;
  const px = Math.max(2, fs(layout, boom.kind === "player" ? 2.4 : 2));
  const cx = fx(layout, boom.x);
  const cy = fy(layout, boom.y);
  const base =
    boom.kind === "player" ? "#ff8a00" : boom.kind === "ufo" ? UFO_RED : boom.color;
  for (const cell of cells) {
    drawPixelRect(
      ctx,
      cx + cell.dx * px - px / 2,
      cy + cell.dy * px - px / 2,
      px,
      px,
      firePalette(base, cell.c),
    );
  }
}

function drawSpaceBackground(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
): void {
  ctx.fillStyle = "#02040a";
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Soft nebula washes (dark, not purple-candy)
  const nebula = ctx.createRadialGradient(
    canvasW * 0.3,
    canvasH * 0.35,
    0,
    canvasW * 0.3,
    canvasH * 0.35,
    canvasW * 0.55,
  );
  nebula.addColorStop(0, "rgba(20, 40, 70, 0.35)");
  nebula.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = nebula;
  ctx.fillRect(0, 0, canvasW, canvasH);

  const nebula2 = ctx.createRadialGradient(
    canvasW * 0.75,
    canvasH * 0.55,
    0,
    canvasW * 0.75,
    canvasH * 0.55,
    canvasW * 0.45,
  );
  nebula2.addColorStop(0, "rgba(40, 18, 50, 0.28)");
  nebula2.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = nebula2;
  ctx.fillRect(0, 0, canvasW, canvasH);

  const t = Math.floor(performance.now() / 450);
  for (let i = 0; i < STAR_SEED.length; i += 1) {
    const star = STAR_SEED[i]!;
    const x = (star.x / FIELD_W) * canvasW;
    const y = (star.y / FIELD_H) * canvasH;
    const twinkle = (i + t) % 5 === 0;
    const alpha = twinkle ? 0.95 : 0.35 + star.c * 0.4;
    ctx.fillStyle = `rgba(230,235,245,${alpha})`;
    const size = twinkle ? star.s + 1 : star.s;
    ctx.fillRect(Math.floor(x), Math.floor(y), size, size);
  }
}

function drawNeonPixelText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  glow: string,
): void {
  // Hard arcade drop shadow
  ctx.fillStyle = "#000000";
  ctx.fillText(text, x + 3, y + 3);
  ctx.fillText(text, x + 2, y + 2);
  // Soft neon bloom
  ctx.save();
  ctx.shadowColor = glow;
  ctx.shadowBlur = 10;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
  // Crisp face on top
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawHudText(
  ctx: CanvasRenderingContext2D,
  layout: InvadersLayout,
  score: number,
  highScore: number,
): void {
  const labelSize = Math.max(8, Math.floor(9 * Math.min(1.6, layout.scale)));
  const valueSize = Math.max(14, Math.floor(16 * Math.min(1.6, layout.scale)));
  const leftX = layout.playX + 4;
  const rightX = layout.playX + layout.playW - 4;
  // Sit in the top margin so big arcade type doesn't cover the fleet
  const valueY = Math.max(valueSize + labelSize + 14, layout.playY - 10);
  const labelY = valueY - valueSize - 4;

  // Subtle chroma pulse so the HUD feels alive
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 420);
  const scoreGlow = `rgba(57, 255, 20, ${0.35 + pulse * 0.35})`;
  const hiGlow = `rgba(30, 144, 255, ${0.35 + (1 - pulse) * 0.35})`;

  ctx.textBaseline = "alphabetic";

  ctx.font = `400 ${labelSize}px ${HUD_FONT}`;
  ctx.textAlign = "left";
  drawNeonPixelText(ctx, "SCORE", leftX, labelY, "#bbf7d0", scoreGlow);
  ctx.font = `400 ${valueSize}px ${HUD_FONT}`;
  drawNeonPixelText(ctx, String(score), leftX, valueY, NEON_GREEN, scoreGlow);

  ctx.font = `400 ${labelSize}px ${HUD_FONT}`;
  ctx.textAlign = "right";
  drawNeonPixelText(ctx, "HI-SCORE", rightX, labelY, "#93c5fd", hiGlow);
  ctx.font = `400 ${valueSize}px ${HUD_FONT}`;
  drawNeonPixelText(ctx, String(highScore), rightX, valueY, "#1e90ff", hiGlow);
}

export function renderInvaders(
  ctx: CanvasRenderingContext2D,
  layout: InvadersLayout,
  engine: SpaceInvadersEngine | null,
  opts?: { dimmed?: boolean; highScore?: number },
): void {
  const { canvasW, canvasH, playX, playY, playW, playH, scale } = layout;
  ctx.clearRect(0, 0, canvasW, canvasH);
  drawSpaceBackground(ctx, canvasW, canvasH);

  // Playfield is open space (no neon frame) — clip game sprites to field
  ctx.save();
  ctx.beginPath();
  ctx.rect(playX, playY, playW, playH);
  ctx.clip();

  if (!engine) {
    ctx.restore();
    if (opts?.dimmed) {
      ctx.fillStyle = "rgba(2,4,10,0.55)";
      ctx.fillRect(0, 0, canvasW, canvasH);
    }
    return;
  }

  const highScore = Math.max(opts?.highScore ?? 0, engine.score);

  // Barriers — flat neon green like the reference
  for (const barrier of engine.barriers) {
    for (let r = 0; r < BARRIER_ROWS; r += 1) {
      for (let c = 0; c < BARRIER_COLS; c += 1) {
        if (!barrier.cells[r]![c]) continue;
        drawPixelRect(
          ctx,
          fx(layout, barrier.x + c * BARRIER_CELL),
          fy(layout, barrier.y + r * BARRIER_CELL),
          fs(layout, BARRIER_CELL),
          fs(layout, BARRIER_CELL),
          NEON_GREEN,
        );
      }
    }
  }

  // Aliens — color by row
  for (const alien of engine.aliens) {
    if (!alien.alive) continue;
    const p = engine.alienWorldPos(alien);
    const frames = engine.animFrame === 0 ? ALIEN_SPRITES : ALIEN_FRAME_B;
    const color = ROW_COLOR[alien.row] ?? ROW_COLOR[4];
    drawSprite(ctx, layout, p.x, p.y, frames[alien.kind], color);
  }

  if (engine.ufo?.alive) {
    drawUfo(ctx, layout, engine.ufo.x, engine.ufo.y);
  }

  const blink = engine.invulnMs > 0 && Math.floor(engine.invulnMs / 80) % 2 === 0;
  if (!blink || engine.hitFlashMs > 0) {
    drawPlayer(ctx, layout, engine.playerX, engine.playerY, engine.hitFlashMs > 0);
  }

  for (const b of engine.bullets) {
    drawPixelRect(
      ctx,
      fx(layout, b.x),
      fy(layout, b.y),
      fs(layout, BULLET_W),
      fs(layout, BULLET_H),
      b.fromPlayer ? "#ffffff" : "#ff2bd6",
    );
  }

  for (const boom of engine.explosions) {
    drawExplosion(ctx, layout, boom);
  }

  // Floor line + lives (reference layout)
  const floorY = engine.playerY + PLAYER_H + 6;
  ctx.fillStyle = "rgba(180,190,200,0.75)";
  ctx.fillRect(playX, fy(layout, floorY), playW, Math.max(1, scale));

  const lifeUnit = scale * 0.65;
  const lifeW = 22 * lifeUnit;
  const lifeGap = 6 * scale;
  const livesY = fy(layout, floorY + 8);
  for (let i = 0; i < engine.lives; i += 1) {
    const lx = playX + 10 + i * (lifeW + lifeGap);
    drawPlayerShipAt(ctx, lx, livesY, lifeUnit, NEON_GREEN);
  }

  ctx.restore();

  // HUD above the clip so it sits cleanly on the field top
  drawHudText(ctx, layout, engine.score, highScore);

  if (engine.phase === "waveclear") {
    ctx.fillStyle = "rgba(2,4,10,0.4)";
    ctx.fillRect(playX, playY, playW, playH);
    ctx.textAlign = "center";
    ctx.font = `400 ${Math.max(14, Math.floor(16 * scale))}px ${HUD_FONT}`;
    drawNeonPixelText(
      ctx,
      "WAVE CLEAR",
      playX + playW / 2,
      playY + playH / 2,
      NEON_GREEN,
      "rgba(57, 255, 20, 0.55)",
    );
  }

  if (opts?.dimmed) {
    ctx.fillStyle = "rgba(2,4,10,0.62)";
    ctx.fillRect(0, 0, canvasW, canvasH);
  }
}
