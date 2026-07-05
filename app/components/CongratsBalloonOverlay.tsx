"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

const BALLOON_COLORS = ["#ff6b6b", "#ffd93d", "#6bcb77", "#4d96ff", "#ff8fab", "#c77dff", "#ffa94d", "#69db7c"];
const SPAWN_INTERVAL_MS = 450;

type ActiveBalloon = {
  id: number;
  left: string;
  duration: string;
  color: string;
  scale: number;
  sway: string;
  spawnOffset: string;
};

type CongratsBalloonOverlayProps = {
  sessionKey: number;
  spawnDurationMs: number;
  onSessionFinished?: () => void;
};

function createBalloon(id: number): ActiveBalloon {
  return {
    id,
    left: `${4 + Math.random() * 92}%`,
    duration: `${4.5 + Math.random() * 2.5}s`,
    color: BALLOON_COLORS[Math.floor(Math.random() * BALLOON_COLORS.length)]!,
    scale: 1.3 + Math.random() * 0.5,
    sway: `${-24 + Math.random() * 48}px`,
    spawnOffset: `${20 + Math.random() * 80}px`,
  };
}

export default function CongratsBalloonOverlay({
  sessionKey,
  spawnDurationMs,
  onSessionFinished,
}: CongratsBalloonOverlayProps) {
  const [balloons, setBalloons] = useState<ActiveBalloon[]>([]);
  const [isSpawning, setIsSpawning] = useState(true);
  const nextBalloonIdRef = useRef(0);
  const spawnIntervalRef = useRef<number | null>(null);
  const spawnStopTimerRef = useRef<number | null>(null);

  const clearSpawnTimers = useCallback(() => {
    if (spawnIntervalRef.current !== null) {
      window.clearInterval(spawnIntervalRef.current);
      spawnIntervalRef.current = null;
    }
    if (spawnStopTimerRef.current !== null) {
      window.clearTimeout(spawnStopTimerRef.current);
      spawnStopTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    nextBalloonIdRef.current = 0;
    setBalloons([createBalloon(nextBalloonIdRef.current++)]);
    setIsSpawning(true);
    clearSpawnTimers();

    spawnIntervalRef.current = window.setInterval(() => {
      setBalloons((previous) => [...previous, createBalloon(nextBalloonIdRef.current++)]);
    }, SPAWN_INTERVAL_MS);

    spawnStopTimerRef.current = window.setTimeout(() => {
      setIsSpawning(false);
      if (spawnIntervalRef.current !== null) {
        window.clearInterval(spawnIntervalRef.current);
        spawnIntervalRef.current = null;
      }
    }, spawnDurationMs);

    return clearSpawnTimers;
  }, [sessionKey, spawnDurationMs, clearSpawnTimers]);

  useEffect(() => {
    if (!isSpawning && balloons.length === 0) {
      onSessionFinished?.();
    }
  }, [balloons.length, isSpawning, onSessionFinished]);

  const onBalloonAnimationEnd = useCallback((balloonId: number) => {
    setBalloons((previous) => previous.filter((balloon) => balloon.id !== balloonId));
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden" aria-hidden>
      {balloons.map((balloon) => (
        <div
          key={balloon.id}
          className="congrats-balloon"
          onAnimationEnd={() => onBalloonAnimationEnd(balloon.id)}
          style={
            {
              left: balloon.left,
              animationDuration: balloon.duration,
              "--balloon-color": balloon.color,
              "--balloon-scale": balloon.scale,
              "--balloon-sway": balloon.sway,
              "--balloon-spawn-offset": balloon.spawnOffset,
            } as CSSProperties
          }
        >
          <div className="congrats-balloon-body" />
          <div className="congrats-balloon-knot" />
          <div className="congrats-balloon-string" />
        </div>
      ))}
    </div>
  );
}
