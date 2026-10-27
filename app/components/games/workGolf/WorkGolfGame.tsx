"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { CloseIcon } from "@/app/components/Icons";
import type { GameScoreScope, GameScoresLeaderboardResponse } from "@/app/types/interfaces";
import { DONT_SWIPE_TABS_CLASSNAME } from "@/app/components/utils/useSwipeBack";
import {
  CLUBS,
  WorkGolfEngine,
  type ClubId,
  type RoundSnapshot,
} from "./workGolfEngine";
import { createWorkGolfScene, type WorkGolfSceneHandle } from "./workGolfScene";
import {
  computeUnlockedMax,
  fetchWorkGolfLeaderboard,
  fetchWorkGolfPlayedLevels,
  isLevelUnlocked,
  submitWorkGolfScore,
} from "./workGolfScores";

type MenuScreen = "title" | "levels" | "playing" | "paused" | "complete" | "highscores";

type WorkGolfGameProps = {
  onExit: () => void;
};

type CompleteInfo = {
  levelNumber: number;
  score: number;
  strokesTotal: number;
  holeScores: number[];
  runRank: number | null;
  personalBest: number | null;
  personalBestRank: number | null;
};

const LEVEL_LIST_COUNT = 30;
const MAX_POWER_DRAG_PX = 160;
const YAW_PER_PX = 0.0075;

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

export default function WorkGolfGame({ onExit }: WorkGolfGameProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<WorkGolfSceneHandle | null>(null);
  const engineRef = useRef<WorkGolfEngine | null>(null);
  const snapRef = useRef<RoundSnapshot | null>(null);
  const screenRef = useRef<MenuScreen>("title");
  const runRecordedRef = useRef(false);
  const completingRef = useRef(false);
  const highScoresBackRef = useRef<MenuScreen>("title");
  const hudAccRef = useRef(0);
  const pointerRef = useRef<{
    mode: "none" | "pan" | "aim";
    id: number;
    startX: number;
    startY: number;
    lastX: number;
  }>({ mode: "none", id: -1, startX: 0, startY: 0, lastX: 0 });

  const [screen, setScreen] = useState<MenuScreen>("title");
  const [hud, setHud] = useState<RoundSnapshot | null>(null);
  const [playedLevels, setPlayedLevels] = useState<number[]>([]);
  const [levelsLoading, setLevelsLoading] = useState(false);
  const [selectedLevel, setSelectedLevel] = useState(1);
  const [completeInfo, setCompleteInfo] = useState<CompleteInfo | null>(null);
  const [leaderboard, setLeaderboard] = useState<GameScoresLeaderboardResponse | null>(null);
  const [leaderboardScope, setLeaderboardScope] = useState<GameScoreScope>("all");
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardLevel, setLeaderboardLevel] = useState(1);
  const [displayedScore, setDisplayedScore] = useState(0);

  const setMenuScreen = (next: MenuScreen) => {
    screenRef.current = next;
    setScreen(next);
  };

  const refreshPlayed = useEffectEvent(async () => {
    setLevelsLoading(true);
    const played = await fetchWorkGolfPlayedLevels();
    setPlayedLevels(played);
    const unlocked = computeUnlockedMax(played);
    setSelectedLevel((prev) => Math.min(prev, unlocked));
    setLevelsLoading(false);
  });

  const loadLeaderboard = useEffectEvent(async (level: number, scope: GameScoreScope) => {
    setLeaderboardLoading(true);
    setLeaderboardLevel(level);
    const board = await fetchWorkGolfLeaderboard(level, scope);
    setLeaderboard(board);
    setLeaderboardLoading(false);
  });

  const recordRun = useEffectEvent(async (engine: WorkGolfEngine): Promise<CompleteInfo> => {
    const base: CompleteInfo = {
      levelNumber: engine.level.levelNumber,
      score: engine.scoreTotal,
      strokesTotal: engine.strokesTotal,
      holeScores: [...engine.holeScores],
      runRank: null,
      personalBest: null,
      personalBestRank: null,
    };
    if (runRecordedRef.current || engine.status !== "complete") return base;
    runRecordedRef.current = true;
    const result = await submitWorkGolfScore(engine.level.levelNumber, engine.scoreTotal);
    if (!result) return base;
    void refreshPlayed();
    return {
      ...base,
      runRank: result.run_rank,
      personalBest: result.personal_best,
      personalBestRank: result.personal_best_rank,
    };
  });

  const startLevel = useEffectEvent((levelNumber: number, playedOverride?: number[]) => {
    const played = playedOverride ?? playedLevels;
    if (!isLevelUnlocked(levelNumber, played)) return;
    runRecordedRef.current = false;
    completingRef.current = false;
    engineRef.current = new WorkGolfEngine(levelNumber);
    snapRef.current = engineRef.current.snapshot();
    setHud(snapRef.current);
    setCompleteInfo(null);
    setMenuScreen("playing");
  });

  useEffect(() => {
    void refreshPlayed();
  }, []);

  useEffect(() => {
    if (screen !== "complete" || !completeInfo) {
      setDisplayedScore(0);
      return;
    }
    const target = completeInfo.score;
    const durationMs = 4000;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // ease-out so it lands softly on the final score
      const eased = 1 - (1 - t) ** 3;
      setDisplayedScore(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [screen, completeInfo]);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const scene = createWorkGolfScene(el);
    sceneRef.current = scene;

    const onResize = () => {
      scene.resize(el.clientWidth, el.clientHeight);
    };
    onResize();
    window.addEventListener("resize", onResize);

    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const engine = engineRef.current;
      const sc = sceneRef.current;
      if (!engine || !sc) return;

      if (screenRef.current === "playing") {
        engine.tick(dt);
        const snap = engine.snapshot();
        snapRef.current = snap;
        sc.sync(engine, snap);

        hudAccRef.current += dt;
        if (hudAccRef.current >= 0.1 || snap.status === "complete" || snap.message) {
          hudAccRef.current = 0;
          setHud(snap);
        }

        if (snap.status === "complete" && !completingRef.current) {
          completingRef.current = true;
          void (async () => {
            const info = await recordRun(engine);
            setPlayedLevels((prev) =>
              prev.includes(info.levelNumber) ? prev : [...prev, info.levelNumber],
            );
            setCompleteInfo(info);
            setMenuScreen("complete");
            void loadLeaderboard(info.levelNumber, leaderboardScope);
          })();
        }
      } else if (snapRef.current) {
        sc.sync(engine, snapRef.current);
      }
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  const onPointerDown = useEffectEvent((e: React.PointerEvent) => {
    if (screenRef.current !== "playing") return;
    const engine = engineRef.current;
    const scene = sceneRef.current;
    const mount = mountRef.current;
    if (!engine || !scene || !mount || engine.status !== "ready" || engine.ball.moving) return;

    const rect = mount.getBoundingClientRect();
    pointerRef.current = {
      mode: scene.pickBall(e.clientX, e.clientY, rect) ? "aim" : "pan",
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
    };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);

    if (pointerRef.current.mode === "aim") {
      engine.beginAim();
    }
  });

  const onPointerMove = useEffectEvent((e: React.PointerEvent) => {
    if (screenRef.current !== "playing") return;
    const p = pointerRef.current;
    if (p.mode === "none" || p.id !== e.pointerId) return;
    const engine = engineRef.current;
    if (!engine) return;

    const dx = e.clientX - p.lastX;
    p.lastX = e.clientX;

    if (p.mode === "pan") {
      engine.setYaw(engine.cameraYaw + dx * YAW_PER_PX);
    } else if (p.mode === "aim") {
      const dy = e.clientY - p.startY;
      const power = Math.max(0, Math.min(1, dy / MAX_POWER_DRAG_PX));
      engine.updateAim(power, dx * YAW_PER_PX);
    }
  });

  const onPointerUp = useEffectEvent((e: React.PointerEvent) => {
    const p = pointerRef.current;
    if (p.mode === "none" || p.id !== e.pointerId) return;
    const engine = engineRef.current;
    if (p.mode === "aim" && engine) {
      engine.releaseShot();
    }
    pointerRef.current.mode = "none";
  });

  const openLevels = () => {
    void refreshPlayed();
    setMenuScreen("levels");
  };

  const openHighScores = (from: MenuScreen, level: number) => {
    highScoresBackRef.current = from;
    setLeaderboardScope("all");
    void loadLeaderboard(level, "all");
    setMenuScreen("highscores");
  };

  const setLeaderboardScopeAndLoad = (scope: GameScoreScope) => {
    setLeaderboardScope(scope);
    void loadLeaderboard(leaderboardLevel, scope);
  };

  const quitToTitle = () => {
    engineRef.current = null;
    snapRef.current = null;
    setHud(null);
    setMenuScreen("title");
  };

  const unlockedMax = computeUnlockedMax(playedLevels);
  const showCanvas = screen === "playing" || screen === "paused" || screen === "complete";

  return (
    <div
      className={`workgolf-root relative flex h-full w-full flex-col overflow-hidden ${DONT_SWIPE_TABS_CLASSNAME}`}
      style={{ touchAction: "none", userSelect: "none", WebkitUserSelect: "none" }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        ref={mountRef}
        className={`absolute inset-0 ${showCanvas ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />

      {/* Soft title / menu backdrop when not in a round */}
      {!showCanvas ? (
        <div className="workgolf-backdrop pointer-events-none absolute inset-0" aria-hidden />
      ) : null}

      <button
        type="button"
        aria-label="Close"
        className="absolute left-3 z-30 mt-[max(0.75rem,env(safe-area-inset-top))] flex h-10 w-10 items-center justify-center rounded-full bg-black/35 text-white"
        onClick={onExit}
      >
        <CloseIcon className="h-5 w-5" />
      </button>

      {screen === "title" ? (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-4 px-6">
          <p className="workgolf-title">Work Golf</p>
          <p className="workgolf-sub">Low-poly links. Five flags. Fewer strokes.</p>
          <div className="workgolf-btns mt-2 flex w-full max-w-sm flex-col items-center gap-3">
            <button type="button" className="workgolf-btn" onClick={openLevels}>
              Play
            </button>
            <button
              type="button"
              className="workgolf-btn"
              onClick={() => openHighScores("title", selectedLevel)}
            >
              High Scores
            </button>
            <button type="button" className="workgolf-btn" onClick={onExit}>
              Exit
            </button>
          </div>
        </div>
      ) : null}

      {screen === "levels" ? (
        <div className="relative z-20 flex flex-1 flex-col px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(3.5rem,env(safe-area-inset-top))]">
          <div className="mb-2 flex items-center justify-between gap-2">
            <button
              type="button"
              className="workgolf-btn !max-w-[6.5rem] !px-3 !py-2 !text-[0.8rem]"
              onClick={() => setMenuScreen("title")}
            >
              Back
            </button>
            <p className="workgolf-title text-center" style={{ fontSize: "1.25rem" }}>
              Levels
            </p>
            <span className="w-[6.5rem]" aria-hidden />
          </div>
          <p className="workgolf-sub mb-3 text-center">Tap a level to play</p>
          <div className="mx-auto min-h-0 w-full max-w-sm flex-1 overflow-y-auto rounded-2xl border border-white/20 bg-black/40 p-3">
            {levelsLoading ? (
              <p className="workgolf-sub p-4 text-center">Loading...</p>
            ) : (
              <ul className="grid grid-cols-3 gap-2">
                {Array.from({ length: Math.max(LEVEL_LIST_COUNT, unlockedMax + 2) }, (_, i) => {
                  const n = i + 1;
                  const unlocked = isLevelUnlocked(n, playedLevels);
                  const played = playedLevels.includes(n);
                  return (
                    <li key={n}>
                      <button
                        type="button"
                        disabled={!unlocked}
                        className={`workgolf-level-cell ${selectedLevel === n ? "is-selected" : ""} ${
                          unlocked ? "" : "is-locked"
                        }`}
                        onClick={() => {
                          if (!unlocked) return;
                          setSelectedLevel(n);
                          startLevel(n);
                        }}
                      >
                        <span className="block text-[0.95rem] font-semibold">{n}</span>
                        <span className="mt-0.5 block text-[0.55rem] opacity-80">
                          {!unlocked ? "Locked" : played ? "Played" : "Open"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {screen === "playing" && hud ? (
        <>
          <div className="pointer-events-none absolute left-0 right-0 top-[max(3.25rem,calc(env(safe-area-inset-top)+2.5rem))] z-20 flex justify-center px-3">
            <div className="workgolf-hud rounded-2xl bg-black/40 px-4 py-2 text-center backdrop-blur-sm">
              <p className="text-[0.7rem] font-semibold tracking-wide text-white">
                Lvl {hud.levelNumber} · Hole {hud.holesCompleted + 1}/5 · Strokes{" "}
                {hud.strokesTotal}
              </p>
              <p className="mt-0.5 text-[0.65rem] text-emerald-200">
                Score {hud.scoreTotal}
                {hud.strokesThisHole > 0 ? ` · This cup ${hud.strokesThisHole}` : ""}
              </p>
              {hud.message ? (
                <p className="mt-1 text-[0.7rem] font-medium text-amber-200">{hud.message}</p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            aria-label="Pause"
            className="absolute right-3 z-30 mt-[max(0.75rem,env(safe-area-inset-top))] flex h-10 w-10 items-center justify-center rounded-full bg-black/35 text-sm font-bold text-white"
            onClick={() => setMenuScreen("paused")}
          >
            II
          </button>
          <div
            className="workgolf-clubs absolute left-2 z-30 flex flex-col gap-2"
            style={{ top: "max(4.5rem, calc(env(safe-area-inset-top) + 3.5rem))" }}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerMove={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
          >
            {(["driver", "chipper", "putter"] as ClubId[]).map((id) => (
              <button
                key={id}
                type="button"
                className={`workgolf-club-btn ${hud.club === id ? "is-active" : ""}`}
                disabled={hud.aiming || hud.status !== "ready"}
                onClick={() => {
                  const engine = engineRef.current;
                  if (!engine) return;
                  engine.setClub(id);
                  const snap = engine.snapshot();
                  snapRef.current = snap;
                  setHud(snap);
                }}
              >
                {CLUBS[id].label}
              </button>
            ))}
          </div>
          <div
            className="workgolf-zoom absolute right-2 z-30 flex flex-col items-center gap-1"
            style={{
              top: "max(4.5rem, calc(env(safe-area-inset-top) + 3.5rem))",
              height: "25vh",
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerMove={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
          >
            <span className="text-[0.55rem] font-semibold text-white/80" aria-hidden>
              +
            </span>
            <input
              type="range"
              className="workgolf-zoom-slider"
              min={0}
              max={100}
              step={1}
              value={Math.round(hud.cameraZoom * 100)}
              aria-label="Camera zoom"
              onChange={(e) => {
                const engine = engineRef.current;
                if (!engine) return;
                engine.setZoom(Number(e.target.value) / 100);
                const snap = engine.snapshot();
                snapRef.current = snap;
                setHud(snap);
              }}
            />
            <span className="text-[0.55rem] font-semibold text-white/80" aria-hidden>
              −
            </span>
          </div>
          {hud.aiming ? (
            <div className="pointer-events-none absolute bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-0 right-0 z-20 flex justify-center">
              <p className="rounded-full bg-black/45 px-3 py-1 text-[0.7rem] text-white">
                Power {Math.round(hud.power * 100)}%
              </p>
            </div>
          ) : hud.status === "ready" ? (
            <div className="pointer-events-none absolute bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-0 right-0 z-20 flex justify-center">
              <p className="rounded-full bg-black/40 px-3 py-1 text-[0.65rem] text-white/90">
                Drag ball down to hit · drag side to aim
              </p>
            </div>
          ) : null}
        </>
      ) : null}

      {screen === "paused" ? (
        <div className="relative z-20 flex flex-1 flex-col items-center justify-center gap-3 bg-black/55 px-6">
          <p className="workgolf-title" style={{ fontSize: "1.4rem" }}>
            Paused
          </p>
          <div className="workgolf-btns flex w-full max-w-sm flex-col items-center gap-3">
            <button type="button" className="workgolf-btn" onClick={() => setMenuScreen("playing")}>
              Resume
            </button>
            <button type="button" className="workgolf-btn" onClick={quitToTitle}>
              Quit
            </button>
          </div>
        </div>
      ) : null}

      {screen === "complete" && completeInfo ? (
        <div className="workgolf-complete relative z-20 flex flex-1 flex-col items-center justify-center px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(3rem,env(safe-area-inset-top))]">
          <div className="workgolf-complete-card w-full max-w-sm">
            <p className="workgolf-title workgolf-complete-item workgolf-complete-d1 text-center">
              Round Done!
            </p>
            <p className="workgolf-complete-score workgolf-complete-item workgolf-complete-d2">
              <span className="workgolf-complete-score-label">Score</span>
              <span className="workgolf-complete-score-value">{displayedScore}</span>
            </p>
            <p className="workgolf-sub workgolf-complete-item workgolf-complete-d3 text-center">
              Level {completeInfo.levelNumber} · {completeInfo.strokesTotal} strokes
            </p>
            <p className="workgolf-complete-cups workgolf-complete-item workgolf-complete-d4">
              {completeInfo.holeScores.map((s, i) => (
                <span key={i} className="workgolf-complete-cup">
                  {s}
                </span>
              ))}
            </p>
            {completeInfo.runRank != null ? (
              <p className="workgolf-complete-rank workgolf-complete-item workgolf-complete-d5">
                Run rank #{completeInfo.runRank}
              </p>
            ) : null}
            {completeInfo.personalBest != null ? (
              <p className="workgolf-sub workgolf-complete-item workgolf-complete-d6 text-center">
                Best {completeInfo.personalBest}
                {completeInfo.personalBestRank != null
                  ? ` · #${completeInfo.personalBestRank}`
                  : ""}
              </p>
            ) : null}

            <div className="workgolf-complete-board workgolf-complete-item workgolf-complete-d7">
              {leaderboardLoading ? (
                <p className="workgolf-sub text-center">Loading board...</p>
              ) : leaderboard ? (
                <ul className="space-y-1.5">
                  {leaderboard.top.map((row, i) => (
                    <li
                      key={`${row.user_id}-${row.created_at}`}
                      className="flex justify-between text-[0.8rem] text-white"
                    >
                      <span>
                        {i + 1}. {row.username}
                      </span>
                      <span className="font-semibold text-emerald-200">{row.score}</span>
                    </li>
                  ))}
                  {leaderboard.top.length === 0 ? (
                    <li className="workgolf-sub text-center">No scores yet.</li>
                  ) : null}
                </ul>
              ) : (
                <p className="workgolf-sub text-center">Could not load scores.</p>
              )}
            </div>

            <div className="workgolf-btns mt-3 flex w-full flex-col items-center gap-2">
              <button
                type="button"
                className="workgolf-btn workgolf-complete-item workgolf-complete-d8"
                onClick={() => {
                  const finished = completeInfo.levelNumber;
                  const nextPlayed = playedLevels.includes(finished)
                    ? playedLevels
                    : [...playedLevels, finished];
                  startLevel(finished + 1, nextPlayed);
                }}
              >
                Next Level
              </button>
              <button
                type="button"
                className="workgolf-btn workgolf-complete-item workgolf-complete-d9"
                onClick={() => startLevel(completeInfo.levelNumber)}
              >
                Replay
              </button>
              <button
                type="button"
                className="workgolf-btn workgolf-complete-item workgolf-complete-d10"
                onClick={() => openHighScores("complete", completeInfo.levelNumber)}
              >
                Full Leaderboard
              </button>
              <button
                type="button"
                className="workgolf-btn workgolf-complete-item workgolf-complete-d11"
                onClick={quitToTitle}
              >
                Title
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {screen === "highscores" ? (
        <div className="relative z-10 flex flex-1 flex-col px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(3.5rem,env(safe-area-inset-top))]">
          <p className="workgolf-title mb-1 text-center" style={{ fontSize: "1.25rem" }}>
            High Scores
          </p>
          <p className="workgolf-sub mb-3 text-center">Level {leaderboardLevel}</p>
          <div className="mx-auto mb-3 flex w-full max-w-sm gap-2">
            <button
              type="button"
              className={`workgolf-btn !py-2 ${leaderboardScope === "all" ? "" : "!opacity-50"}`}
              onClick={() => setLeaderboardScopeAndLoad("all")}
            >
              All
            </button>
            <button
              type="button"
              className={`workgolf-btn !py-2 ${leaderboardScope === "friends" ? "" : "!opacity-50"}`}
              onClick={() => setLeaderboardScopeAndLoad("friends")}
            >
              Friends
            </button>
          </div>
          <div className="mx-auto w-full max-w-sm flex-1 overflow-y-auto rounded-2xl border border-white/20 bg-black/45">
            {leaderboardLoading ? (
              <p className="workgolf-sub p-4 text-center">Loading...</p>
            ) : !leaderboard ? (
              <p className="workgolf-sub p-4 text-center">Could not load scores.</p>
            ) : (
              <div className="divide-y divide-white/10">
                <div className="px-3 py-3">
                  <p className="text-[0.55rem] font-semibold uppercase tracking-wide text-sky-200">
                    You
                  </p>
                  {leaderboard.me.personal_best == null ? (
                    <p className="workgolf-sub mt-1">No scores yet.</p>
                  ) : (
                    <p className="mt-1 text-[0.8rem] text-white">
                      #{leaderboard.me.rank} · {leaderboard.me.personal_best}
                      <span className="ml-2 text-white/50">@{leaderboard.me.username}</span>
                    </p>
                  )}
                </div>
                <div className="px-3 py-3">
                  <p className="mb-2 text-[0.55rem] font-semibold uppercase tracking-wide text-sky-200">
                    Top 3
                  </p>
                  {leaderboard.top.length === 0 ? (
                    <p className="workgolf-sub">No scores yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {leaderboard.top.map((row, i) => (
                        <li
                          key={`${row.user_id}-${row.score}-${row.created_at}`}
                          className="flex items-center gap-3"
                        >
                          <span className="w-6 text-[0.7rem] text-white/50">{i + 1}</span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[0.75rem] text-white">{row.username}</p>
                            <p className="text-[0.55rem] text-white/50">
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
          <div className="workgolf-btns mx-auto mt-3 flex w-full max-w-sm flex-col items-center">
            <button
              type="button"
              className="workgolf-btn"
              onClick={() => setMenuScreen(highScoresBackRef.current)}
            >
              Back
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
