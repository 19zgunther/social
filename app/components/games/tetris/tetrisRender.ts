import {
  BOARD_COLS,
  BOARD_ROWS,
  CLEAR_FLASH_MS,
  CLEAR_FLASH_PERIOD_MS,
  HIDDEN_ROWS,
  NEXT_COUNT,
  TetrisEngine,
  getPieceCells,
  getPieceColor,
  type PieceType,
} from "./tetrisEngine";

export type TetrisLayout = {
  canvasW: number;
  canvasH: number;
  playX: number;
  playY: number;
  cell: number;
  playW: number;
  playH: number;
};

export function computeTetrisLayout(
  canvasW: number,
  canvasH: number,
  mode: "game" | "backdrop" = "game",
): TetrisLayout {
  const topReserve =
    mode === "backdrop"
      ? Math.max(24, canvasH * 0.06)
      : Math.max(72, Math.min(110, canvasH * 0.12));
  // One control row under the board (side buttons sit in the gutters).
  const bottomReserve =
    mode === "backdrop"
      ? Math.max(24, canvasH * 0.06)
      : Math.max(72, Math.min(100, canvasH * 0.13));
  const sidePad =
    mode === "backdrop" ? 8 : Math.max(56, Math.min(80, Math.floor(canvasW * 0.17)));
  const availableW = canvasW - sidePad * 2;
  const availableH = canvasH - topReserve - bottomReserve;
  const cell = Math.max(8, Math.floor(Math.min(availableW / BOARD_COLS, availableH / BOARD_ROWS)));
  const playW = cell * BOARD_COLS;
  const playH = cell * BOARD_ROWS;
  const playX = Math.floor((canvasW - playW) / 2);
  const playY = Math.floor(topReserve + (availableH - playH) / 2);
  return { canvasW, canvasH, playX, playY, cell, playW, playH };
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawCell(
  ctx: CanvasRenderingContext2D,
  layout: TetrisLayout,
  boardX: number,
  boardY: number,
  color: string,
  alpha = 1,
  outlineOnly = false,
): void {
  const visibleY = boardY - HIDDEN_ROWS;
  if (visibleY < 0 || visibleY >= BOARD_ROWS) return;
  if (boardX < 0 || boardX >= BOARD_COLS) return;
  const x = layout.playX + boardX * layout.cell;
  const y = layout.playY + visibleY * layout.cell;
  const pad = Math.max(1, Math.floor(layout.cell * 0.06));
  const size = layout.cell - pad * 2;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (outlineOnly) {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, layout.cell * 0.08);
    drawRoundedRect(ctx, x + pad, y + pad, size, size, Math.max(2, layout.cell * 0.12));
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    drawRoundedRect(ctx, x + pad, y + pad, size, size, Math.max(2, layout.cell * 0.12));
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    drawRoundedRect(
      ctx,
      x + pad,
      y + pad,
      size,
      Math.max(2, size * 0.28),
      Math.max(2, layout.cell * 0.1),
    );
    ctx.fill();
  }
  ctx.restore();
}

function drawMiniPiece(
  ctx: CanvasRenderingContext2D,
  type: PieceType | null,
  cx: number,
  cy: number,
  cell: number,
  dimmed = false,
): void {
  if (!type) return;
  const cells = getPieceCells(type, 0);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [y, x] of cells) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const w = (maxX - minX + 1) * cell;
  const h = (maxY - minY + 1) * cell;
  const ox = cx - w / 2;
  const oy = cy - h / 2;
  const color = getPieceColor(type);
  ctx.save();
  ctx.globalAlpha = dimmed ? 0.4 : 1;
  for (const [y, x] of cells) {
    const px = ox + (x - minX) * cell;
    const py = oy + (y - minY) * cell;
    const pad = Math.max(1, cell * 0.08);
    ctx.fillStyle = color;
    drawRoundedRect(ctx, px + pad, py + pad, cell - pad * 2, cell - pad * 2, Math.max(1, cell * 0.15));
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Sync canvas backing-store size to CSS × DPR.
 * Ignores 1px jitter (mobile browser chrome) to avoid GPU buffer realloc thrash.
 */
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

/** Paint from the live engine (sync) — no board snapshot copy. */
export function renderTetris(
  ctx: CanvasRenderingContext2D,
  layout: TetrisLayout,
  engine: TetrisEngine | null,
  opts?: { dimmed?: boolean; backdrop?: boolean; hideHud?: boolean },
): void {
  const { canvasW, canvasH, playX, playY, cell, playW, playH } = layout;
  const backdrop = opts?.backdrop === true;
  const hideHud = backdrop || opts?.hideHud === true;
  ctx.clearRect(0, 0, canvasW, canvasH);

  if (!backdrop) {
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, canvasW, canvasH);
  }

  // Menu background only (title/copy live in the React overlay)
  if (!engine) return;

  if (!hideHud) {
    ctx.textAlign = "left";
    ctx.fillStyle = "#e2e8f0";
    ctx.font = `700 ${Math.max(14, Math.floor(cell * 0.7))}px system-ui, sans-serif`;
    ctx.fillText(`SCORE  ${engine.score}`, 16, 28);
    ctx.font = `600 ${Math.max(12, Math.floor(cell * 0.55))}px system-ui, sans-serif`;
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(`LVL ${engine.level}   LINES ${engine.lines}`, 16, 50);

    const miniCell = Math.max(8, Math.floor(cell * 0.55));
    const boxW = miniCell * 5;
    const boxH = miniCell * 3.2;
    const holdX = 12;
    const holdY = 62;
    const nextX = canvasW - boxW - 12;
    const nextY = 62;

    ctx.fillStyle = "rgba(15,23,42,0.7)";
    drawRoundedRect(ctx, holdX, holdY, boxW, boxH, 8);
    ctx.fill();
    drawRoundedRect(ctx, nextX, nextY, boxW, boxH + miniCell * 6, 8);
    ctx.fill();

    ctx.fillStyle = "#64748b";
    ctx.font = `600 ${Math.max(10, Math.floor(miniCell * 0.7))}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("HOLD", holdX + boxW / 2, holdY + 14);
    ctx.fillText("NEXT", nextX + boxW / 2, nextY + 14);

    drawMiniPiece(
      ctx,
      engine.hold,
      holdX + boxW / 2,
      holdY + boxH / 2 + 4,
      miniCell,
      !engine.canHold,
    );

    for (let i = 0; i < NEXT_COUNT && i < engine.nextQueue.length; i += 1) {
      drawMiniPiece(
        ctx,
        engine.nextQueue[i]!,
        nextX + boxW / 2,
        nextY + 28 + i * (miniCell * 2.6) + miniCell,
        miniCell,
      );
    }
  }

  // Playfield frame
  ctx.fillStyle = backdrop ? "rgba(2,6,23,0.35)" : "rgba(2,6,23,0.85)";
  drawRoundedRect(ctx, playX - 4, playY - 4, playW + 8, playH + 8, 10);
  ctx.fill();
  ctx.strokeStyle = backdrop ? "rgba(148,163,184,0.2)" : "rgba(148,163,184,0.35)";
  ctx.lineWidth = 2;
  drawRoundedRect(ctx, playX - 4, playY - 4, playW + 8, playH + 8, 10);
  ctx.stroke();

  // Grid
  ctx.strokeStyle = "rgba(148,163,184,0.08)";
  ctx.lineWidth = 1;
  for (let c = 0; c <= BOARD_COLS; c += 1) {
    const x = playX + c * cell;
    ctx.beginPath();
    ctx.moveTo(x, playY);
    ctx.lineTo(x, playY + playH);
    ctx.stroke();
  }
  for (let r = 0; r <= BOARD_ROWS; r += 1) {
    const y = playY + r * cell;
    ctx.beginPath();
    ctx.moveTo(playX, y);
    ctx.lineTo(playX + playW, y);
    ctx.stroke();
  }

  // Locked cells
  const clearing = engine.clearingRows;
  const flash = engine.phase === "clearing";
  const clearElapsed = Math.max(0, CLEAR_FLASH_MS - engine.clearFlashRemaining);
  const clearFlashWhite =
    Math.floor(clearElapsed / (CLEAR_FLASH_PERIOD_MS / 2)) % 2 === 0;
  for (let y = HIDDEN_ROWS; y < HIDDEN_ROWS + BOARD_ROWS; y += 1) {
    for (let x = 0; x < BOARD_COLS; x += 1) {
      const cellType = engine.board[y]![x];
      if (!cellType) continue;
      const isClearing = clearing.includes(y);
      if (flash && isClearing) {
        drawCell(ctx, layout, x, y, clearFlashWhite ? "#ffffff" : "#050505", 1);
      } else {
        drawCell(ctx, layout, x, y, getPieceColor(cellType));
      }
    }
  }

  // Ghost + active
  const active = engine.active;
  if (active && engine.phase !== "clearing") {
    const ghostY = engine.ghostY();
    const color = getPieceColor(active.type);
    for (const [dy, dx] of getPieceCells(active.type, active.rotation)) {
      drawCell(ctx, layout, active.x + dx, ghostY + dy, color, 0.35, true);
    }
    for (const [dy, dx] of getPieceCells(active.type, active.rotation)) {
      drawCell(ctx, layout, active.x + dx, active.y + dy, color);
    }
  }

  if (opts?.dimmed) {
    ctx.fillStyle = "rgba(2,6,23,0.55)";
    ctx.fillRect(0, 0, canvasW, canvasH);
  }
}
