"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PoolGameMessageData } from "@/app/types/interfaces";
import BackButton from "@/app/components/utils/BackButton";
import { DONT_SWIPE_TABS_CLASSNAME } from "@/app/components/utils/useSwipeBack";
import {
  flipTurn,
  isPoolTurnForUser,
  respawnCueBallInKitchen,
} from "@/app/components/games/poolGameUtils";
import {
  allBallsAtRest,
  applyCueImpulse,
  cloneBalls,
  getPoolPocketCenters,
  stepSimulation,
} from "@/app/components/games/poolPhysics";

type PoolProps = {
  game: PoolGameMessageData;
  currentUsername: string;
  onBack: () => void;
  onTurnComplete: (nextGame: PoolGameMessageData) => Promise<void>;
  /** When false (e.g. /dev/games), stay on the table after a shot instead of exiting. Default true. */
  exitAfterTurn?: boolean;
  backLabel?: string;
};

function deepCopyGame(game: PoolGameMessageData): PoolGameMessageData {
  return {
    ...game,
    balls: cloneBalls(game.balls),
  };
}

const SHOT_POWER_MIN = 0.08;
const SHOT_POWER_MAX = 1;

function aimDistanceRange(tableW: number, tableH: number): { min: number; max: number } {
  const s = Math.min(tableW, tableH);
  return { min: s * 0.055, max: s * 1.2 };
}

function distanceToShotPower(dist: number, minD: number, maxD: number): number {
  if (maxD <= minD) {
    return SHOT_POWER_MIN;
  }
  const t = (dist - minD) / (maxD - minD);
  return SHOT_POWER_MIN + Math.min(1, Math.max(0, t)) * (SHOT_POWER_MAX - SHOT_POWER_MIN);
}

function clampAimHandleToRay(
  cueX: number,
  cueY: number,
  pointerX: number,
  pointerY: number,
  minD: number,
  maxD: number,
): { x: number; y: number } {
  const dx = pointerX - cueX;
  const dy = pointerY - cueY;
  const len = Math.hypot(dx, dy);
  if (len < 1e-8) {
    return { x: cueX + minD, y: cueY };
  }
  const d = Math.min(maxD, Math.max(minD, len));
  return {
    x: cueX + (dx / len) * d,
    y: cueY + (dy / len) * d,
  };
}

export default function Pool({
  game,
  currentUsername,
  onBack,
  onTurnComplete,
  exitAfterTurn = true,
  backLabel = "Thread",
}: PoolProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simGameRef = useRef<PoolGameMessageData | null>(null);
  const rafRef = useRef<number | null>(null);
  const aimingPointerIdRef = useRef<number | null>(null);
  const gameBeforeShotRef = useRef<PoolGameMessageData | null>(null);

  const [workingGame, setWorkingGame] = useState<PoolGameMessageData>(() => deepCopyGame(game));
  const [aimHandleTable, setAimHandleTable] = useState<{ x: number; y: number }>(() => {
    const cue = game.balls.find((b) => b.id === 0 && !b.pocketed);
    if (!cue) {
      return { x: 0, y: 0 };
    }
    const { min, max } = aimDistanceRange(game.table_w, game.table_h);
    const aimAtX = game.table_w / 2;
    const aimAtY = game.table_h * 0.36;
    return clampAimHandleToRay(cue.x, cue.y, aimAtX, aimAtY, min, max);
  });
  const [isSimulating, setIsSimulating] = useState(false);
  const [isSendingTurn, setIsSendingTurn] = useState(false);
  const [statusLine, setStatusLine] = useState("");

  const isMyTurn = isPoolTurnForUser(workingGame, currentUsername);

  useEffect(() => {
    setWorkingGame(deepCopyGame(game));
    const cue = game.balls.find((b) => b.id === 0 && !b.pocketed);
    if (cue) {
      const { min, max } = aimDistanceRange(game.table_w, game.table_h);
      const aimAtX = game.table_w / 2;
      const aimAtY = game.table_h * 0.36;
      setAimHandleTable(clampAimHandleToRay(cue.x, cue.y, aimAtX, aimAtY, min, max));
    }
  }, [game]);

  const drawFrame = useCallback(
    (g: PoolGameMessageData) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return;
      }

      const w = canvas.width;
      const h = canvas.height;
      const tw = g.table_w;
      const th = g.table_h;
      const sx = w / tw;
      const sy = h / th;

      ctx.save();
      ctx.fillStyle = "#0d3d22";
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = "#5c3d1e";
      ctx.lineWidth = Math.max(8, w * 0.02);
      ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);

      const pockets = getPoolPocketCenters(tw, th);
      const pocketRadiusPx = Math.min(w, h) * 0.045;
      for (const p of pockets) {
        ctx.beginPath();
        ctx.arc(p.x * sx, p.y * sy, pocketRadiusPx, 0, Math.PI * 2);
        ctx.fillStyle = "#0a0a0a";
        ctx.fill();
      }

      const ballColor = (id: number): string => {
        if (id === 0) {
          return "#f8f8f0";
        }
        const palette = [
          "#f5d400",
          "#2563eb",
          "#dc2626",
          "#7c3aed",
          "#ea580c",
          "#16a34a",
          "#be185d",
          "#0d9488",
          "#111827",
          "#f5d400",
          "#2563eb",
          "#dc2626",
          "#7c3aed",
          "#ea580c",
          "#16a34a",
        ];
        return palette[(id - 1) % palette.length];
      };

      for (const ball of g.balls) {
        if (ball.pocketed) {
          continue;
        }
        const cx = ball.x * sx;
        const cy = ball.y * sy;
        const rad = ball.r * Math.min(sx, sy);
        const grd = ctx.createRadialGradient(cx - rad * 0.3, cy - rad * 0.3, rad * 0.1, cx, cy, rad);
        grd.addColorStop(0, "#ffffffcc");
        grd.addColorStop(0.35, ballColor(ball.id));
        grd.addColorStop(1, "#00000055");
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();
        ctx.strokeStyle = "#00000044";
        ctx.lineWidth = 1;
        ctx.stroke();
        if (ball.id === 8) {
          ctx.fillStyle = "#fff";
          ctx.font = `${rad * 1.1}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("8", cx, cy);
        }
      }

      const cue = g.balls.find((b) => b.id === 0 && !b.pocketed);
      const simulating = simGameRef.current !== null;
      if (cue && isMyTurn && !simulating) {
        const cx = cue.x * sx;
        const cy = cue.y * sy;
        const hx = aimHandleTable.x * sx;
        const hy = aimHandleTable.y * sy;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(hx, hy);
        ctx.strokeStyle = "rgba(255,255,255,0.4)";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
        const handleR = Math.max(20, Math.min(sx, sy) * 0.1);
        ctx.beginPath();
        ctx.arc(hx, hy, handleR, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.1)";
        ctx.fill();
        ctx.strokeStyle = "rgba(10,132,255,0.2)";
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      ctx.restore();
    },
    [aimHandleTable.x, aimHandleTable.y, isMyTurn],
  );

  useEffect(() => {
    drawFrame(workingGame);
  }, [workingGame, drawFrame]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ro = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const nw = Math.max(320, Math.floor(rect.width * dpr));
      const nh = Math.max(200, Math.floor(rect.height * dpr));
      if (canvas.width !== nw || canvas.height !== nh) {
        canvas.width = nw;
        canvas.height = nh;
        drawFrame(simGameRef.current ?? workingGame);
      }
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [drawFrame, workingGame]);

  const stopSimLoop = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  useEffect(() => {
    return () => stopSimLoop();
  }, []);

  const onCanvasPointer = (clientX: number, clientY: number) => {
    if (isSimulating || !isMyTurn) {
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * workingGame.table_w;
    const ny = ((clientY - rect.top) / rect.height) * workingGame.table_h;
    const cue = workingGame.balls.find((b) => b.id === 0 && !b.pocketed);
    if (!cue) {
      return;
    }
    const { min, max } = aimDistanceRange(workingGame.table_w, workingGame.table_h);
    setAimHandleTable(clampAimHandleToRay(cue.x, cue.y, nx, ny, min, max));
  };

  const runSimulationAndFinish = useCallback(
    (startGame: PoolGameMessageData) => {
      setStatusLine("");
      simGameRef.current = deepCopyGame(startGame);
      setIsSimulating(true);
      const g = simGameRef.current;
      if (!g) {
        setIsSimulating(false);
        return;
      }

      let last = performance.now();

      const tick = (now: number) => {
        const active = simGameRef.current;
        if (!active) {
          return;
        }
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        stepSimulation(active, dt);
        drawFrame(active);

        if (allBallsAtRest(active.balls)) {
          stopSimLoop();
          simGameRef.current = null;
          setIsSimulating(false);

          const cuePocketed = active.balls.some((b) => b.id === 0 && b.pocketed);
          if (cuePocketed) {
            respawnCueBallInKitchen(active.balls, active.table_w, active.table_h);
          }

          const nextTurn = flipTurn(active);
          const nextGame: PoolGameMessageData = {
            ...active,
            current_turn_username: nextTurn,
            balls: cloneBalls(active.balls),
          };

          setWorkingGame(nextGame);
          setIsSendingTurn(true);
          void onTurnComplete(nextGame)
            .then(() => {
              setStatusLine("");
              gameBeforeShotRef.current = null;
              if (exitAfterTurn) {
                onBack();
              }
            })
            .catch(() => {
              const revert = gameBeforeShotRef.current;
              gameBeforeShotRef.current = null;
              if (revert) {
                setWorkingGame(deepCopyGame(revert));
              }
              setStatusLine("Could not send turn. Try again.");
            })
            .finally(() => {
              setIsSendingTurn(false);
            });
          return;
        }

        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
    },
    [drawFrame, exitAfterTurn, onBack, onTurnComplete],
  );

  const onShoot = () => {
    if (!isMyTurn || isSimulating || isSendingTurn) {
      return;
    }
    const cue = workingGame.balls.find((b) => b.id === 0 && !b.pocketed);
    if (!cue) {
      setStatusLine("Cue ball is pocketed — tap Back.");
      return;
    }
    const { min, max } = aimDistanceRange(workingGame.table_w, workingGame.table_h);
    const dx = aimHandleTable.x - cue.x;
    const dy = aimHandleTable.y - cue.y;
    const aimAngle = Math.atan2(dy, dx);
    const dist = Math.hypot(dx, dy);
    const power = distanceToShotPower(dist, min, max);

    gameBeforeShotRef.current = deepCopyGame(workingGame);
    const shotGame = deepCopyGame(workingGame);
    applyCueImpulse(shotGame, aimAngle, power);
    void runSimulationAndFinish(shotGame);
  };

  return (
    <div
      className={`flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-primary-background ${DONT_SWIPE_TABS_CLASSNAME}`}
    >
      <div className="flex items-center justify-between border-b border-accent-1 bg-secondary-background px-2 py-2">
        <BackButton onBack={onBack} backLabel={backLabel} />
        <div className="min-w-0 flex-1 px-2 text-center">
          <p className="truncate text-sm font-semibold text-foreground">Pool</p>
          <p className="truncate text-xs text-accent-2">
            {isMyTurn
              ? "Your turn"
              : workingGame.current_turn_username
                ? `Waiting for ${workingGame.current_turn_username}`
                : workingGame.player_b_username === null
                  ? "Waiting for Player 2"
                  : `Waiting for ${workingGame.player_b_username}`}
          </p>
        </div>
        <div className="w-14" />
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden px-2 pb-2 pt-2">
        {/*
          flex-1 + aspect-ratio on the canvas alone can force a huge min-height and push
          the power/shoot row below the viewport (overflow-hidden then clips it). Keep the
          table in a min-h-0 flex-1 shell and cap the canvas with max-h-full.
        */}
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
          <canvas
            ref={canvasRef}
            className="mx-auto w-full max-w-lg touch-none rounded-xl border border-accent-1 bg-[#0d3d22]"
            style={{
              aspectRatio: `${workingGame.table_w} / ${workingGame.table_h}`,
              maxHeight: "100%",
            }}
            onPointerDown={(e) => {
              aimingPointerIdRef.current = e.pointerId;
              e.currentTarget.setPointerCapture(e.pointerId);
              onCanvasPointer(e.clientX, e.clientY);
            }}
            onPointerUp={(e) => {
              if (aimingPointerIdRef.current === e.pointerId) {
                aimingPointerIdRef.current = null;
              }
            }}
            onPointerCancel={(e) => {
              if (aimingPointerIdRef.current === e.pointerId) {
                aimingPointerIdRef.current = null;
              }
            }}
            onPointerMove={(e) => {
              if (aimingPointerIdRef.current === e.pointerId) {
                onCanvasPointer(e.clientX, e.clientY);
              }
            }}
          />
        </div>

        <div className="mt-3 shrink-0 space-y-2">
          <button
            type="button"
            onClick={onShoot}
            disabled={!isMyTurn || isSimulating || isSendingTurn}
            className="w-full rounded-full bg-accent-3 py-3 text-sm font-semibold text-primary-background transition hover:brightness-110 disabled:opacity-50"
          >
            {isSimulating ? "Shot in progress…" : isSendingTurn ? "Sending turn…" : "Shoot"}
          </button>
          {statusLine ? <p className="text-center text-xs text-accent-2">{statusLine}</p> : null}
        </div>
      </div>
    </div>
  );
}
