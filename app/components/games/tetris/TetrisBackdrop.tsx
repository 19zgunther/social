"use client";

import { useEffect, useRef } from "react";
import {
  BOARD_COLS,
  TOTAL_ROWS,
  TetrisEngine,
  getPieceCells,
  type Cell,
  type PieceType,
} from "./tetrisEngine";
import { computeTetrisLayout, renderTetris } from "./tetrisRender";

type Placement = { rotation: number; x: number };

function collidesAt(
  board: Cell[][],
  type: PieceType,
  rotation: number,
  px: number,
  py: number,
): boolean {
  for (const [dy, dx] of getPieceCells(type, rotation)) {
    const y = py + dy;
    const x = px + dx;
    if (x < 0 || x >= BOARD_COLS || y < 0 || y >= TOTAL_ROWS) return true;
    if (board[y]![x]) return true;
  }
  return false;
}

function dropY(
  board: Cell[][],
  type: PieceType,
  rotation: number,
  px: number,
  startY: number,
): number {
  let y = startY;
  while (!collidesAt(board, type, rotation, px, y + 1)) {
    y += 1;
  }
  return y;
}

function evaluateBoard(board: Cell[][]): number {
  let holes = 0;
  let aggregateHeight = 0;
  let bumpiness = 0;
  const heights: number[] = [];

  for (let x = 0; x < BOARD_COLS; x += 1) {
    let height = 0;
    let seenBlock = false;
    for (let y = 0; y < TOTAL_ROWS; y += 1) {
      if (board[y]![x]) {
        if (!seenBlock) {
          height = TOTAL_ROWS - y;
          seenBlock = true;
        }
      } else if (seenBlock) {
        holes += 1;
      }
    }
    heights.push(height);
    aggregateHeight += height;
  }

  for (let x = 0; x < BOARD_COLS - 1; x += 1) {
    bumpiness += Math.abs(heights[x]! - heights[x + 1]!);
  }

  let lines = 0;
  for (let y = 0; y < TOTAL_ROWS; y += 1) {
    if (board[y]!.every((cell) => cell !== null)) lines += 1;
  }

  return lines * 760 - aggregateHeight * 18 - holes * 140 - bumpiness * 12;
}

function choosePlacement(board: Cell[][], type: PieceType, startY: number): Placement {
  let best: Placement = { rotation: 0, x: 3 };
  let bestScore = -Infinity;

  for (let rotation = 0; rotation < 4; rotation += 1) {
    for (let x = -2; x < BOARD_COLS; x += 1) {
      if (collidesAt(board, type, rotation, x, startY)) continue;
      const y = dropY(board, type, rotation, x, startY);
      if (collidesAt(board, type, rotation, x, y)) continue;

      const sim = board.map((row) => [...row]);
      for (const [dy, dx] of getPieceCells(type, rotation)) {
        const cy = y + dy;
        const cx = x + dx;
        if (cy >= 0 && cy < TOTAL_ROWS && cx >= 0 && cx < BOARD_COLS) {
          sim[cy]![cx] = type;
        }
      }
      const score = evaluateBoard(sim) + Math.random() * 8;
      if (score > bestScore) {
        bestScore = score;
        best = { rotation, x };
      }
    }
  }
  return best;
}

/**
 * Decorative autoplaying Tetris for page / menu backgrounds.
 * Not interactive — pointer-events none, loops on game over.
 *
 * - `page`: translucent overlay (login screen)
 * - `menu`: full dark playfield behind Tetris title UI
 */
export default function TetrisBackdrop({
  className = "",
  opacity = 0.45,
  variant = "page",
}: {
  className?: string;
  opacity?: number;
  variant?: "page" | "menu";
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) return;

    const engine = new TetrisEngine();
    engine.startNewGame();

    let raf = 0;
    let lastTs: number | null = null;
    let actionAcc = 0;
    let target: Placement | null = null;
    let restartAt: number | null = null;
    const isMenu = variant === "menu";

    const paint = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      if (cssW <= 0 || cssH <= 0) return;
      if (canvas.width !== Math.floor(cssW * dpr) || canvas.height !== Math.floor(cssH * dpr)) {
        canvas.width = Math.floor(cssW * dpr);
        canvas.height = Math.floor(cssH * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const layout = computeTetrisLayout(cssW, cssH, "backdrop");
      renderTetris(ctx, layout, engine.snapshot(), {
        backdrop: !isMenu,
        hideHud: true,
      });
    };

    const planIfNeeded = () => {
      if (!engine.active || engine.phase !== "playing") {
        target = null;
        return;
      }
      if (target) return;
      target = choosePlacement(engine.board, engine.active.type, engine.active.y);
    };

    const stepBot = () => {
      if (engine.phase === "gameover") return;
      if (engine.phase === "clearing" || !engine.active) {
        target = null;
        return;
      }
      planIfNeeded();
      if (!target) return;

      if (engine.active.rotation !== target.rotation) {
        engine.rotate(1);
        return;
      }
      if (engine.active.x < target.x) {
        engine.moveRight();
        return;
      }
      if (engine.active.x > target.x) {
        engine.moveLeft();
        return;
      }
      engine.hardDrop();
      target = null;
    };

    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      const last = lastTs ?? ts;
      const dt = Math.min(40, ts - last);
      lastTs = ts;

      if (engine.phase === "gameover") {
        if (restartAt === null) restartAt = ts + 900;
        if (ts >= restartAt) {
          engine.startNewGame();
          target = null;
          restartAt = null;
        }
        paint();
        return;
      }

      engine.update(dt * 0.85, false);

      actionAcc += dt;
      if (actionAcc >= 85) {
        actionAcc = 0;
        stepBot();
      }

      paint();
    };

    raf = requestAnimationFrame(loop);
    const onResize = () => paint();
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [variant]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
      style={{ opacity }}
    />
  );
}
