"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { CloseIcon } from "@/app/components/Icons";
import { TetrisEngine, type TetrisSnapshot } from "./tetrisEngine";
import { computeTetrisLayout, renderTetris } from "./tetrisRender";
import {
  clearTetrisHighScores,
  readTetrisHighScores,
  tryAddTetrisHighScore,
  type TetrisHighScore,
} from "./tetrisScores";
import TetrisBackdrop from "./TetrisBackdrop";

type MenuScreen = "title" | "playing" | "paused" | "gameover" | "highscores" | "controls";

type TetrisGameProps = {
  onExit: () => void;
};

export default function TetrisGame({ onExit }: TetrisGameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<TetrisEngine | null>(null);
  const snapRef = useRef<TetrisSnapshot | null>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const softDropTouchRef = useRef(false);
  /** After a piece locks while soft-dropping, ignore hold until release. */
  const softDropNeedsReleaseRef = useRef(false);
  const touchLeftRef = useRef(false);
  const touchRightRef = useRef(false);
  const lastTsRef = useRef<number | null>(null);
  const dasRef = useRef<{ key: string | null; charged: boolean; acc: number }>({
    key: null,
    charged: false,
    acc: 0,
  });
  const screenRef = useRef<MenuScreen>("title");
  const [screen, setScreen] = useState<MenuScreen>("title");
  const [scores, setScores] = useState<TetrisHighScore[]>([]);
  const [gameOverInfo, setGameOverInfo] = useState<{
    score: number;
    level: number;
    lines: number;
    madeList: boolean;
    rank: number | null;
  } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);

  const setMenuScreen = (next: MenuScreen) => {
    screenRef.current = next;
    setScreen(next);
  };

  const paint = useEffectEvent(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (canvas.width !== Math.floor(cssW * dpr) || canvas.height !== Math.floor(cssH * dpr)) {
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const layout = computeTetrisLayout(cssW, cssH);
    if (screenRef.current === "title") {
      renderTetris(ctx, layout, null);
      return;
    }
    const dimmed = screenRef.current !== "playing";
    renderTetris(ctx, layout, snapRef.current, { dimmed });
  });

  const startGame = useEffectEvent(() => {
    const engine = new TetrisEngine();
    engine.startNewGame();
    engineRef.current = engine;
    snapRef.current = engine.snapshot();
    softDropTouchRef.current = false;
    softDropNeedsReleaseRef.current = false;
    touchLeftRef.current = false;
    touchRightRef.current = false;
    keysRef.current.clear();
    dasRef.current = { key: null, charged: false, acc: 0 };
    lastTsRef.current = null;
    setGameOverInfo(null);
    setConfirmRestart(false);
    setMenuScreen("playing");
    paint();
  });

  const handleGameOver = useEffectEvent(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const result = tryAddTetrisHighScore({
      score: engine.score,
      level: engine.level,
      lines: engine.lines,
    });
    setScores(result.scores);
    setGameOverInfo({
      score: engine.score,
      level: engine.level,
      lines: engine.lines,
      madeList: result.madeList,
      rank: result.rank,
    });
    setMenuScreen("gameover");
  });

  useEffect(() => {
    setScores(readTetrisHighScores());
  }, []);

  useEffect(() => {
    let raf = 0;
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      if (screenRef.current !== "playing") {
        lastTsRef.current = ts;
        paint();
        return;
      }
      const engine = engineRef.current;
      if (!engine) return;
      const last = lastTsRef.current ?? ts;
      const dt = Math.min(50, ts - last);
      lastTsRef.current = ts;

      // DAS / ARR for left-right hold (keyboard + touch)
      const keys = keysRef.current;
      const left =
        touchLeftRef.current || keys.has("ArrowLeft") || keys.has("KeyA");
      const right =
        touchRightRef.current || keys.has("ArrowRight") || keys.has("KeyD");
      const horizontal = left && !right ? "left" : right && !left ? "right" : null;
      if (!horizontal) {
        dasRef.current = { key: null, charged: false, acc: 0 };
      } else if (dasRef.current.key !== horizontal) {
        dasRef.current = { key: horizontal, charged: false, acc: 0 };
        if (horizontal === "left") engine.moveLeft();
        else engine.moveRight();
      } else {
        dasRef.current.acc += dt;
        const delay = dasRef.current.charged ? 50 : 170;
        if (dasRef.current.acc >= delay) {
          dasRef.current.acc = 0;
          dasRef.current.charged = true;
          if (horizontal === "left") engine.moveLeft();
          else engine.moveRight();
        }
      }

      const softHeld =
        softDropTouchRef.current || keys.has("ArrowDown") || keys.has("KeyS");
      const softDropping = softHeld && !softDropNeedsReleaseRef.current;
      const becameOver = engine.update(dt, softDropping);
      if (softDropping && engine.justLocked) {
        softDropNeedsReleaseRef.current = true;
        softDropTouchRef.current = false;
        keysRef.current.delete("ArrowDown");
        keysRef.current.delete("KeyS");
      }
      snapRef.current = engine.snapshot();
      paint();
      if (becameOver || engine.phase === "gameover") {
        handleGameOver();
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat && (e.code === "Space" || e.code === "KeyC" || e.code === "KeyX" || e.code === "KeyZ")) {
        return;
      }
      if (screenRef.current === "playing") {
        const engine = engineRef.current;
        if (!engine) return;
        switch (e.code) {
          case "ArrowLeft":
          case "KeyA":
          case "ArrowRight":
          case "KeyD":
          case "ArrowDown":
          case "KeyS":
            keysRef.current.add(e.code);
            e.preventDefault();
            break;
          case "ArrowUp":
          case "KeyX":
            engine.rotate(1);
            snapRef.current = engine.snapshot();
            e.preventDefault();
            break;
          case "KeyZ":
            engine.rotate(-1);
            snapRef.current = engine.snapshot();
            e.preventDefault();
            break;
          case "Space":
            softDropNeedsReleaseRef.current = true;
            softDropTouchRef.current = false;
            keysRef.current.delete("ArrowDown");
            keysRef.current.delete("KeyS");
            engine.hardDrop();
            snapRef.current = engine.snapshot();
            if (engine.phase === "gameover") handleGameOver();
            e.preventDefault();
            break;
          case "KeyC":
            engine.holdPiece();
            snapRef.current = engine.snapshot();
            e.preventDefault();
            break;
          case "KeyP":
          case "Escape":
            setMenuScreen("paused");
            e.preventDefault();
            break;
          default:
            break;
        }
        return;
      }

      if (screenRef.current === "paused") {
        if (e.code === "KeyP" || e.code === "Escape") {
          setConfirmRestart(false);
          setMenuScreen("playing");
          e.preventDefault();
        }
        return;
      }

      if (screenRef.current === "title" && e.code === "Escape") {
        onExit();
        e.preventDefault();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.code);
      if (e.code === "ArrowDown" || e.code === "KeyS") {
        softDropNeedsReleaseRef.current = false;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [onExit]);

  useEffect(() => {
    const onResize = () => paint();
    window.addEventListener("resize", onResize);
    paint();
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onControl = (action: string) => {
    if (screenRef.current !== "playing") return;
    const engine = engineRef.current;
    if (!engine) return;
    switch (action) {
      case "left":
        engine.moveLeft();
        break;
      case "right":
        engine.moveRight();
        break;
      case "soft":
        if (!softDropNeedsReleaseRef.current) engine.softDrop();
        break;
      case "hard":
        softDropNeedsReleaseRef.current = true;
        softDropTouchRef.current = false;
        engine.hardDrop();
        break;
      case "rotcw":
        engine.rotate(1);
        break;
      case "rotccw":
        engine.rotate(-1);
        break;
      case "hold":
        engine.holdPiece();
        break;
      case "pause":
        softDropTouchRef.current = false;
        touchLeftRef.current = false;
        touchRightRef.current = false;
        setMenuScreen("paused");
        break;
      default:
        break;
    }
    snapRef.current = engine.snapshot();
    if (engine.phase === "gameover") handleGameOver();
  };

  const highScoresBackRef = useRef<MenuScreen>("title");

  const openHighScores = () => {
    highScoresBackRef.current =
      screenRef.current === "gameover" ? "gameover" : "title";
    setScores(readTetrisHighScores());
    setConfirmClear(false);
    setMenuScreen("highscores");
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return iso;
    }
  };

  const showTitleBackdrop =
    screen === "title" || screen === "controls" || (screen === "highscores" && !gameOverInfo);

  return (
    <div className="relative flex h-full w-full flex-col bg-[#0b1220]">
      {showTitleBackdrop ? (
        <TetrisBackdrop variant="menu" opacity={0.85} className="z-0" />
      ) : null}
      <canvas
        ref={canvasRef}
        className={`pointer-events-none absolute inset-0 h-full w-full ${showTitleBackdrop ? "opacity-0" : ""}`}
      />

      {/* Safe-area exit on title */}
      {screen === "title" ? (
        <button
          type="button"
          onClick={onExit}
          className="absolute right-3 z-20 rounded-full border border-white/15 bg-black/40 p-2 text-white mt-[max(0.75rem,env(safe-area-inset-top))]"
          aria-label="Exit"
        >
          <CloseIcon className="h-5 w-5" />
        </button>
      ) : null}

      {/* Menus */}
      {screen === "title" ? (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-4 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(3rem,env(safe-area-inset-top))]">
          <div className="mb-2 text-center">
            <h1 className="tetris-title-mark">TETRIS</h1>
            <p className="tetris-menu-sub mt-3">Clear lines. Don&apos;t top out.</p>
          </div>
          <div className="tetris-menu-btns flex w-full flex-col items-center gap-3">
            <button type="button" className="tetris-menu-btn" onClick={startGame}>
              Play
            </button>
            <button type="button" className="tetris-menu-btn" onClick={openHighScores}>
              High Scores
            </button>
            <button
              type="button"
              className="tetris-menu-btn"
              onClick={() => setMenuScreen("controls")}
            >
              Controls
            </button>
            <button type="button" className="tetris-menu-btn" onClick={onExit}>
              Exit
            </button>
          </div>
        </div>
      ) : null}

      {screen === "paused" ? (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-3 px-6">
          <p className="tetris-title-mark mb-2" style={{ fontSize: "1.65rem" }}>
            Paused
          </p>
          {confirmRestart ? (
            <div className="tetris-menu-btns flex w-full flex-col items-center gap-3">
              <p className="tetris-menu-sub text-center">Restart and lose this run?</p>
              <button type="button" className="tetris-menu-btn" onClick={startGame}>
                Confirm
              </button>
              <button
                type="button"
                className="tetris-menu-btn"
                onClick={() => setConfirmRestart(false)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="tetris-menu-btns flex w-full flex-col items-center gap-3">
              <button
                type="button"
                className="tetris-menu-btn"
                onClick={() => setMenuScreen("playing")}
              >
                Resume
              </button>
              <button
                type="button"
                className="tetris-menu-btn"
                onClick={() => setConfirmRestart(true)}
              >
                Restart
              </button>
              <button
                type="button"
                className="tetris-menu-btn"
                onClick={() => setMenuScreen("title")}
              >
                Quit
              </button>
            </div>
          )}
        </div>
      ) : null}

      {screen === "gameover" && gameOverInfo ? (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-3 px-6">
          <p className="tetris-title-mark" style={{ fontSize: "1.45rem" }}>
            Game Over
          </p>
          <p className="tetris-pixel-font text-[0.8rem] text-cyan-200">
            SCORE {gameOverInfo.score}
          </p>
          <p className="tetris-menu-sub">
            LVL {gameOverInfo.level} · LINES {gameOverInfo.lines}
          </p>
          {gameOverInfo.madeList ? (
            <p className="tetris-pixel-font text-[0.7rem] text-emerald-400">
              NEW HIGH SCORE{gameOverInfo.rank ? ` #${gameOverInfo.rank}` : ""}
            </p>
          ) : null}
          <div className="tetris-menu-btns mt-2 flex w-full flex-col items-center gap-3">
            <button type="button" className="tetris-menu-btn" onClick={startGame}>
              Play Again
            </button>
            <button type="button" className="tetris-menu-btn" onClick={openHighScores}>
              High Scores
            </button>
            <button
              type="button"
              className="tetris-menu-btn"
              onClick={() => setMenuScreen("title")}
            >
              Exit
            </button>
          </div>
        </div>
      ) : null}

      {screen === "highscores" ? (
        <div className="relative z-10 flex flex-1 flex-col px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(3.5rem,env(safe-area-inset-top))]">
          <p className="tetris-title-mark mb-3 text-center" style={{ fontSize: "1.25rem" }}>
            High Scores
          </p>
          <div className="mx-auto w-full max-w-sm flex-1 overflow-y-auto border-3 border-cyan-400/50 bg-black/60 [border-style:solid] [border-width:3px]">
            {scores.length === 0 ? (
              <p className="tetris-menu-sub p-4 text-center">No scores yet.</p>
            ) : (
              <ul className="divide-y divide-white/10">
                {scores.map((row, i) => (
                  <li key={`${row.at}-${row.score}-${i}`} className="flex items-center gap-3 px-3 py-2.5">
                    <span className="tetris-pixel-font w-7 text-[0.7rem] text-slate-400">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="tetris-pixel-font text-[0.8rem] text-white">{row.score}</p>
                      <p className="tetris-pixel-font mt-1 text-[0.58rem] text-slate-400">
                        L{row.level} · {row.lines}LN · {formatDate(row.at)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="tetris-menu-btns mx-auto mt-3 flex w-full max-w-sm flex-col items-center gap-2">
            {confirmClear ? (
              <>
                <p className="tetris-menu-sub text-center">Clear all local scores?</p>
                <button
                  type="button"
                  className="tetris-menu-btn"
                  onClick={() => {
                    clearTetrisHighScores();
                    setScores([]);
                    setConfirmClear(false);
                  }}
                >
                  Confirm Clear
                </button>
                <button
                  type="button"
                  className="tetris-menu-btn"
                  onClick={() => setConfirmClear(false)}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="tetris-menu-btn"
                  onClick={() => setConfirmClear(true)}
                  disabled={scores.length === 0}
                >
                  Clear Scores
                </button>
                <button
                  type="button"
                  className="tetris-menu-btn"
                  onClick={() => setMenuScreen(highScoresBackRef.current)}
                >
                  Back
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}

      {screen === "controls" ? (
        <div className="relative z-10 flex flex-1 flex-col px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(3.5rem,env(safe-area-inset-top))]">
          <p className="tetris-title-mark mb-3 text-center" style={{ fontSize: "1.25rem" }}>
            Controls
          </p>
          <div className="tetris-pixel-font mx-auto w-full max-w-sm flex-1 overflow-y-auto border-[3px] border-cyan-400/50 bg-black/60 p-4 text-[0.65rem] leading-relaxed text-slate-200 space-y-3">
            <div>
              <p className="mb-1 text-cyan-300">Keyboard</p>
              <ul className="space-y-1 text-slate-300">
                <li>← → — Move</li>
                <li>↓ — Soft drop</li>
                <li>↑ / X — Rotate CW</li>
                <li>Z — Rotate CCW</li>
                <li>Space — Hard drop</li>
                <li>C — Hold</li>
                <li>P / Esc — Pause</li>
              </ul>
            </div>
            <div>
              <p className="mb-1 text-cyan-300">Touch</p>
              <ul className="space-y-1 text-slate-300">
                <li>← ↓ → ↻ primary row</li>
                <li>DROP · ↺ · HOLD below</li>
                <li>Pause (II) top-right</li>
              </ul>
            </div>
          </div>
          <div className="tetris-menu-btns mx-auto mt-3 flex w-full max-w-sm flex-col items-center">
            <button
              type="button"
              className="tetris-menu-btn"
              onClick={() => setMenuScreen("title")}
            >
              Back
            </button>
          </div>
        </div>
      ) : null}

      {screen === "playing" ? (
        <button
          type="button"
          aria-label="Pause"
          className="tetris-ctrl-pause absolute right-3 z-20 mt-[max(0.75rem,env(safe-area-inset-top))]"
          onContextMenu={(e) => e.preventDefault()}
          onPointerDown={(e) => {
            e.preventDefault();
            onControl("pause");
          }}
        >
          II
        </button>
      ) : null}

      {/* Touch controls — one-thumb friendly: big move/rotate/down, secondary drop */}
      {screen === "playing" ? (
        <div
          className="absolute bottom-0 left-0 right-0 z-10 px-2.5 pb-[max(0.6rem,env(safe-area-inset-bottom))] pt-1 select-none [-webkit-touch-callout:none]"
          style={{ touchAction: "none", userSelect: "none", WebkitUserSelect: "none" }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="mx-auto flex w-full max-w-lg flex-col gap-2">
            <div className="flex gap-2">
              <button
                type="button"
                aria-label="Move left"
                className="tetris-ctrl tetris-ctrl-lg tetris-ctrl-left"
                onContextMenu={(e) => e.preventDefault()}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  touchRightRef.current = false;
                  touchLeftRef.current = true;
                  dasRef.current = { key: null, charged: false, acc: 0 };
                }}
                onPointerUp={() => {
                  touchLeftRef.current = false;
                }}
                onPointerCancel={() => {
                  touchLeftRef.current = false;
                }}
              >
                ←
              </button>
              <button
                type="button"
                aria-label="Soft drop"
                className="tetris-ctrl tetris-ctrl-lg tetris-ctrl-soft"
                onContextMenu={(e) => e.preventDefault()}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  softDropNeedsReleaseRef.current = false;
                  softDropTouchRef.current = true;
                  onControl("soft");
                }}
                onPointerUp={() => {
                  softDropTouchRef.current = false;
                  softDropNeedsReleaseRef.current = false;
                }}
                onPointerCancel={() => {
                  softDropTouchRef.current = false;
                  softDropNeedsReleaseRef.current = false;
                }}
              >
                ↓
              </button>
              <button
                type="button"
                aria-label="Move right"
                className="tetris-ctrl tetris-ctrl-lg tetris-ctrl-right"
                onContextMenu={(e) => e.preventDefault()}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  touchLeftRef.current = false;
                  touchRightRef.current = true;
                  dasRef.current = { key: null, charged: false, acc: 0 };
                }}
                onPointerUp={() => {
                  touchRightRef.current = false;
                }}
                onPointerCancel={() => {
                  touchRightRef.current = false;
                }}
              >
                →
              </button>
              <button
                type="button"
                aria-label="Rotate clockwise"
                className="tetris-ctrl tetris-ctrl-lg tetris-ctrl-rotcw"
                onContextMenu={(e) => e.preventDefault()}
                onPointerDown={(e) => {
                  e.preventDefault();
                  onControl("rotcw");
                }}
              >
                ↻
              </button>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                aria-label="Hard drop"
                className="tetris-ctrl tetris-ctrl-sm tetris-ctrl-drop"
                onContextMenu={(e) => e.preventDefault()}
                onPointerDown={(e) => {
                  e.preventDefault();
                  onControl("hard");
                }}
              >
                DROP
              </button>
              <button
                type="button"
                aria-label="Rotate counter-clockwise"
                className="tetris-ctrl tetris-ctrl-sm tetris-ctrl-rotccw"
                onContextMenu={(e) => e.preventDefault()}
                onPointerDown={(e) => {
                  e.preventDefault();
                  onControl("rotccw");
                }}
              >
                ↺
              </button>
              <button
                type="button"
                aria-label="Hold"
                className="tetris-ctrl tetris-ctrl-sm tetris-ctrl-hold"
                onContextMenu={(e) => e.preventDefault()}
                onPointerDown={(e) => {
                  e.preventDefault();
                  onControl("hold");
                }}
              >
                HOLD
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
