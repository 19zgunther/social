"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { CloseIcon } from "@/app/components/Icons";
import type { GameScoreScope, GameScoresLeaderboardResponse } from "@/app/types/interfaces";
import { SpaceInvadersEngine } from "./spaceInvadersEngine";
import {
  computeInvadersLayout,
  renderInvaders,
  syncCanvasBackingStore,
  type InvadersLayout,
} from "./spaceInvadersRender";
import {
  fetchSpaceInvadersLeaderboard,
  submitSpaceInvadersScore,
} from "./spaceInvadersScores";

type MenuScreen = "title" | "playing" | "paused" | "gameover" | "highscores" | "controls";

type SpaceInvadersGameProps = {
  onExit: () => void;
};

type GameOverInfo = {
  score: number;
  wave: number;
  runRank: number | null;
  personalBest: number | null;
  personalBestRank: number | null;
};

function gameOverInfoFromEngine(
  engine: SpaceInvadersEngine,
  ranks?: {
    runRank: number | null;
    personalBest: number | null;
    personalBestRank: number | null;
  },
): GameOverInfo {
  return {
    score: engine.score,
    wave: engine.wave,
    runRank: ranks?.runRank ?? null,
    personalBest: ranks?.personalBest ?? null,
    personalBestRank: ranks?.personalBestRank ?? null,
  };
}

export default function SpaceInvadersGame({ onExit }: SpaceInvadersGameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<SpaceInvadersEngine | null>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const touchLeftRef = useRef(false);
  const touchRightRef = useRef(false);
  const touchFireRef = useRef(false);
  const runRecordedRef = useRef(false);
  const lastTsRef = useRef<number | null>(null);
  const rafRef = useRef(0);
  const screenRef = useRef<MenuScreen>("title");
  const [screen, setScreen] = useState<MenuScreen>("title");
  const [leaderboard, setLeaderboard] = useState<GameScoresLeaderboardResponse | null>(null);
  const [leaderboardScope, setLeaderboardScope] = useState<GameScoreScope>("all");
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [gameOverInfo, setGameOverInfo] = useState<GameOverInfo | null>(null);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [playLayout, setPlayLayout] = useState<InvadersLayout | null>(null);
  const highScoreRef = useRef(0);
  const playLayoutRef = useRef<InvadersLayout | null>(null);

  const syncPlayLayout = useEffectEvent((layout: InvadersLayout) => {
    const prev = playLayoutRef.current;
    if (
      prev &&
      prev.playX === layout.playX &&
      prev.playY === layout.playY &&
      prev.playW === layout.playW &&
      prev.playH === layout.playH &&
      prev.canvasW === layout.canvasW &&
      prev.canvasH === layout.canvasH
    ) {
      return;
    }
    playLayoutRef.current = layout;
    setPlayLayout(layout);
  });

  const paint = useEffectEvent(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const { cssW, cssH } = syncCanvasBackingStore(canvas, dpr);
    if (cssW <= 0 || cssH <= 0) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const layout = computeInvadersLayout(cssW, cssH);
    syncPlayLayout(layout);
    const engine = screenRef.current === "title" ? null : engineRef.current;
    if (engine && engine.score > highScoreRef.current) {
      highScoreRef.current = engine.score;
    }
    renderInvaders(ctx, layout, engine, {
      dimmed: screenRef.current !== "playing" && screenRef.current !== "title",
      highScore: highScoreRef.current,
    });
  });

  const stopLoop = useEffectEvent(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  });

  const recordCurrentRun = useEffectEvent(async (): Promise<GameOverInfo | null> => {
    const engine = engineRef.current;
    if (!engine) return null;
    if (engine.score <= 0 || runRecordedRef.current) {
      return gameOverInfoFromEngine(engine);
    }
    runRecordedRef.current = true;
    const result = await submitSpaceInvadersScore(engine.score);
    if (!result) return gameOverInfoFromEngine(engine);
    if (result.personal_best > highScoreRef.current) {
      highScoreRef.current = result.personal_best;
    }
    return gameOverInfoFromEngine(engine, {
      runRank: result.run_rank,
      personalBest: result.personal_best,
      personalBestRank: result.personal_best_rank,
    });
  });

  const handleGameOver = useEffectEvent(() => {
    if (screenRef.current !== "playing") return;
    screenRef.current = "gameover";
    stopLoop();
    void (async () => {
      const recorded = await recordCurrentRun();
      const engine = engineRef.current;
      setGameOverInfo(recorded ?? (engine ? gameOverInfoFromEngine(engine) : null));
      setScreen("gameover");
      paint();
    })();
  });

  const tick = useEffectEvent((ts: number) => {
    rafRef.current = 0;
    if (document.hidden || screenRef.current !== "playing") {
      lastTsRef.current = ts;
      paint();
      return;
    }
    const engine = engineRef.current;
    if (!engine) return;
    const last = lastTsRef.current ?? ts;
    const dt = Math.min(50, ts - last);
    lastTsRef.current = ts;

    const keys = keysRef.current;
    const left = touchLeftRef.current || keys.has("ArrowLeft") || keys.has("KeyA");
    const right = touchRightRef.current || keys.has("ArrowRight") || keys.has("KeyD");
    const moveDir: -1 | 0 | 1 = left && !right ? -1 : right && !left ? 1 : 0;
    const wantsFire =
      touchFireRef.current || keys.has("Space") || keys.has("ArrowUp") || keys.has("KeyW");

    // After the last life, keep ticking so the death fire can finish before the menu.
    const move = engine.phase === "gameover" ? 0 : moveDir;
    const fire = engine.phase === "gameover" ? false : wantsFire;
    engine.update(dt, move, fire);
    paint();
    if (engine.phase === "gameover") {
      if (engine.explosions.length > 0) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      handleGameOver();
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  });

  const ensureLoop = useEffectEvent(() => {
    if (rafRef.current) return;
    if (document.hidden || screenRef.current !== "playing") return;
    lastTsRef.current = null;
    paint();
    rafRef.current = requestAnimationFrame(tick);
  });

  const setMenuScreen = (next: MenuScreen) => {
    screenRef.current = next;
    setScreen(next);
    if (next === "playing") {
      ensureLoop();
    } else {
      stopLoop();
      paint();
    }
  };

  const loadLeaderboard = useEffectEvent(async (scope: GameScoreScope) => {
    setLeaderboardLoading(true);
    const board = await fetchSpaceInvadersLeaderboard(scope);
    setLeaderboard(board);
    setLeaderboardLoading(false);
  });

  const startGame = useEffectEvent(() => {
    const engine = new SpaceInvadersEngine();
    engine.startNewGame();
    engineRef.current = engine;
    touchLeftRef.current = false;
    touchRightRef.current = false;
    touchFireRef.current = false;
    runRecordedRef.current = false;
    keysRef.current.clear();
    lastTsRef.current = null;
    setGameOverInfo(null);
    setConfirmRestart(false);
    setMenuScreen("playing");
  });

  const quitToTitle = useEffectEvent(() => {
    void recordCurrentRun();
    setConfirmRestart(false);
    setMenuScreen("title");
  });

  const restartAfterSaving = useEffectEvent(() => {
    void (async () => {
      await recordCurrentRun();
      startGame();
    })();
  });

  useEffect(() => {
    void (async () => {
      const board = await fetchSpaceInvadersLeaderboard("all");
      const best = board?.me.personal_best ?? 0;
      if (best > highScoreRef.current) {
        highScoreRef.current = best;
      }
    })();
  }, []);

  // iOS: kill text selection / callouts / magnifier while the game is open.
  useEffect(() => {
    const block = (e: Event) => e.preventDefault();
    document.addEventListener("selectstart", block, true);
    document.addEventListener("gesturestart", block, true);
    return () => {
      document.removeEventListener("selectstart", block, true);
      document.removeEventListener("gesturestart", block, true);
    };
  }, []);

  useEffect(() => {
    return () => {
      stopLoop();
      const engine = engineRef.current;
      const scr = screenRef.current;
      if (
        !runRecordedRef.current &&
        engine &&
        engine.score > 0 &&
        (scr === "playing" || scr === "paused")
      ) {
        runRecordedRef.current = true;
        void submitSpaceInvadersScore(engine.score);
      }
    };
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        stopLoop();
        lastTsRef.current = null;
      } else if (screenRef.current === "playing") {
        ensureLoop();
      } else {
        paint();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (screenRef.current === "playing") {
        switch (e.code) {
          case "ArrowLeft":
          case "KeyA":
          case "ArrowRight":
          case "KeyD":
          case "Space":
          case "ArrowUp":
          case "KeyW":
            keysRef.current.add(e.code);
            e.preventDefault();
            break;
          case "KeyP":
          case "Escape":
            touchLeftRef.current = false;
            touchRightRef.current = false;
            touchFireRef.current = false;
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

  const highScoresBackRef = useRef<MenuScreen>("title");

  const openHighScores = () => {
    highScoresBackRef.current =
      screenRef.current === "gameover" ? "gameover" : "title";
    setMenuScreen("highscores");
    void loadLeaderboard(leaderboardScope);
  };

  const setLeaderboardScopeAndLoad = (scope: GameScoreScope) => {
    setLeaderboardScope(scope);
    void loadLeaderboard(scope);
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

  return (
    <div
      className="si-root relative flex h-full w-full flex-col select-none"
      style={{
        WebkitUserSelect: "none",
        userSelect: "none",
        WebkitTouchCallout: "none",
        WebkitTapHighlightColor: "transparent",
        touchAction: "manipulation",
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 h-full w-full select-none"
        style={{ WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none" }}
      />

      {screen === "title" ? (
        <button
          type="button"
          onClick={onExit}
          className="absolute right-3 z-20 rounded-full border border-emerald-500/30 bg-black/50 p-2 text-emerald-200 mt-[max(0.75rem,env(safe-area-inset-top))]"
          aria-label="Exit"
        >
          <CloseIcon className="h-5 w-5" />
        </button>
      ) : null}

      {screen === "title" ? (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-4 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(3rem,env(safe-area-inset-top))]">
          <div className="mb-2 text-center">
            <h1 className="si-title-mark">INVADERS</h1>
            <p className="si-menu-sub mt-3">Defend the dark. Don&apos;t let them land.</p>
          </div>
          <div className="si-menu-btns flex w-full flex-col items-center gap-3">
            <button type="button" className="si-menu-btn" onClick={startGame}>
              Play
            </button>
            <button type="button" className="si-menu-btn" onClick={openHighScores}>
              High Scores
            </button>
            <button
              type="button"
              className="si-menu-btn"
              onClick={() => setMenuScreen("controls")}
            >
              Controls
            </button>
            <button type="button" className="si-menu-btn" onClick={onExit}>
              Exit
            </button>
          </div>
        </div>
      ) : null}

      {screen === "paused" ? (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-3 px-6">
          <p className="si-title-mark mb-2" style={{ fontSize: "1.65rem" }}>
            Paused
          </p>
          {confirmRestart ? (
            <div className="si-menu-btns flex w-full flex-col items-center gap-3">
              <p className="si-menu-sub text-center">Restart? Score will be saved.</p>
              <button type="button" className="si-menu-btn" onClick={restartAfterSaving}>
                Confirm
              </button>
              <button
                type="button"
                className="si-menu-btn"
                onClick={() => setConfirmRestart(false)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="si-menu-btns flex w-full flex-col items-center gap-3">
              <button
                type="button"
                className="si-menu-btn"
                onClick={() => setMenuScreen("playing")}
              >
                Resume
              </button>
              <button
                type="button"
                className="si-menu-btn"
                onClick={() => setConfirmRestart(true)}
              >
                Restart
              </button>
              <button type="button" className="si-menu-btn" onClick={quitToTitle}>
                Quit
              </button>
            </div>
          )}
        </div>
      ) : null}

      {screen === "gameover" && gameOverInfo ? (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-3 px-6">
          <p className="si-title-mark" style={{ fontSize: "1.45rem" }}>
            Game Over
          </p>
          <p className="si-pixel-font text-[0.8rem] text-lime-300">SCORE {gameOverInfo.score}</p>
          <p className="si-menu-sub">WAVE {gameOverInfo.wave}</p>
          {gameOverInfo.runRank != null ? (
            <p className="si-pixel-font text-[0.7rem] text-emerald-400">
              RUN RANK #{gameOverInfo.runRank}
            </p>
          ) : null}
          {gameOverInfo.personalBest != null ? (
            <p className="si-menu-sub">
              BEST {gameOverInfo.personalBest}
              {gameOverInfo.personalBestRank != null
                ? ` · #${gameOverInfo.personalBestRank}`
                : ""}
            </p>
          ) : null}
          <div className="si-menu-btns mt-2 flex w-full flex-col items-center gap-3">
            <button type="button" className="si-menu-btn" onClick={startGame}>
              Play Again
            </button>
            <button type="button" className="si-menu-btn" onClick={openHighScores}>
              High Scores
            </button>
            <button
              type="button"
              className="si-menu-btn"
              onClick={() => setMenuScreen("title")}
            >
              Exit
            </button>
          </div>
        </div>
      ) : null}

      {screen === "highscores" ? (
        <div className="relative z-10 flex flex-1 flex-col px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(3.5rem,env(safe-area-inset-top))]">
          <p className="si-title-mark mb-3 text-center" style={{ fontSize: "1.25rem" }}>
            High Scores
          </p>
          <div className="mx-auto mb-3 flex w-full max-w-sm gap-2">
            <button
              type="button"
              className={`si-menu-btn !max-w-none !px-2 !py-2 !text-[0.55rem] ${
                leaderboardScope === "all" ? "" : "!opacity-50"
              }`}
              onClick={() => setLeaderboardScopeAndLoad("all")}
            >
              All Time
            </button>
            <button
              type="button"
              className={`si-menu-btn !max-w-none !px-2 !py-2 !text-[0.55rem] ${
                leaderboardScope === "friends" ? "" : "!opacity-50"
              }`}
              onClick={() => setLeaderboardScopeAndLoad("friends")}
            >
              Friends
            </button>
          </div>
          <div className="mx-auto w-full max-w-sm flex-1 overflow-y-auto border-[3px] border-emerald-500/40 bg-black/70">
            {leaderboardLoading ? (
              <p className="si-menu-sub p-4 text-center">Loading...</p>
            ) : !leaderboard ? (
              <p className="si-menu-sub p-4 text-center">Could not load scores.</p>
            ) : (
              <div className="divide-y divide-white/10">
                <div className="px-3 py-3">
                  <p className="si-pixel-font text-[0.55rem] text-lime-300">YOU</p>
                  {leaderboard.me.personal_best == null ? (
                    <p className="si-menu-sub mt-1">No scores yet.</p>
                  ) : (
                    <p className="si-pixel-font mt-1 text-[0.75rem] text-white">
                      #{leaderboard.me.rank}
                      {leaderboard.total > 0 ? ` of ${leaderboard.total}` : ""} ·{" "}
                      {leaderboard.me.personal_best}
                      <span className="ml-2 text-slate-400">@{leaderboard.me.username}</span>
                    </p>
                  )}
                </div>
                <div className="px-3 py-3">
                  <p className="si-pixel-font mb-2 text-[0.55rem] text-lime-300">
                    BOARD · {leaderboardScope === "friends" ? "FRIENDS" : "ALL"}
                  </p>
                  {leaderboard.top.length === 0 ? (
                    <p className="si-menu-sub">No scores yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {leaderboard.top.map((row) => (
                        <li
                          key={`${row.user_id}-${row.score}-${row.created_at}`}
                          className="flex items-center gap-3"
                        >
                          <span className="si-pixel-font w-7 text-[0.7rem] text-slate-400">
                            #{row.rank}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="si-pixel-font truncate text-[0.7rem] text-white">
                              {row.username}
                            </p>
                            <p className="si-pixel-font mt-0.5 text-[0.55rem] text-slate-400">
                              {row.score} · {formatDate(row.created_at)}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="si-menu-btns mx-auto mt-3 flex w-full max-w-sm flex-col items-center gap-2">
            <button
              type="button"
              className="si-menu-btn"
              onClick={() => setMenuScreen(highScoresBackRef.current)}
            >
              Back
            </button>
          </div>
        </div>
      ) : null}

      {screen === "controls" ? (
        <div className="relative z-10 flex flex-1 flex-col px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(3.5rem,env(safe-area-inset-top))]">
          <p className="si-title-mark mb-3 text-center" style={{ fontSize: "1.25rem" }}>
            Controls
          </p>
          <div className="si-pixel-font mx-auto w-full max-w-sm flex-1 overflow-y-auto border-[3px] border-emerald-500/40 bg-black/70 p-4 text-[0.65rem] leading-relaxed text-slate-200 space-y-3">
            <div>
              <p className="mb-1 text-lime-300">Keyboard</p>
              <ul className="space-y-1 text-slate-300">
                <li>← → / A D — Move</li>
                <li>Hold Space / ↑ / W — Auto-fire</li>
                <li>P / Esc — Pause</li>
              </ul>
            </div>
            <div>
              <p className="mb-1 text-lime-300">Touch</p>
              <ul className="space-y-1 text-slate-300">
                <li>← → left · Hold FIRE right</li>
                <li>II — Pause</li>
              </ul>
            </div>
          </div>
          <div className="si-menu-btns mx-auto mt-3 flex w-full max-w-sm flex-col items-center">
            <button
              type="button"
              className="si-menu-btn"
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
          className="si-ctrl-pause absolute right-3 z-20 mt-[max(0.75rem,env(safe-area-inset-top))]"
          onContextMenu={(e) => e.preventDefault()}
          onPointerDown={(e) => {
            e.preventDefault();
            touchLeftRef.current = false;
            touchRightRef.current = false;
            touchFireRef.current = false;
            setMenuScreen("paused");
          }}
        >
          II
        </button>
      ) : null}

      {screen === "playing" && playLayout ? (
        <div
          className="pointer-events-none absolute inset-0 z-10 select-none [-webkit-touch-callout:none]"
          style={{ touchAction: "none", userSelect: "none", WebkitUserSelect: "none" }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div
            className="pointer-events-auto absolute flex gap-2 px-2.5"
            style={{
              left: 0,
              right: 0,
              top: playLayout.playY + playLayout.playH + 8,
            }}
          >
            <button
              type="button"
              aria-label="Move left"
              className="si-ctrl si-ctrl-lg si-ctrl-left"
              onContextMenu={(e) => e.preventDefault()}
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                touchRightRef.current = false;
                touchLeftRef.current = true;
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
              aria-label="Move right"
              className="si-ctrl si-ctrl-lg si-ctrl-right"
              onContextMenu={(e) => e.preventDefault()}
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                touchLeftRef.current = false;
                touchRightRef.current = true;
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
              aria-label="Fire"
              className="si-ctrl si-ctrl-lg si-ctrl-fire"
              onContextMenu={(e) => e.preventDefault()}
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                touchFireRef.current = true;
              }}
              onPointerUp={() => {
                touchFireRef.current = false;
              }}
              onPointerCancel={() => {
                touchFireRef.current = false;
              }}
            >
              FIRE
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
