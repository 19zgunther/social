"use client";

import { useEffect, useState } from "react";
import type { AnimationClip } from "./types";
import { DEFAULT_CLIP } from "./defaultClip";
import { computeWorldJoints } from "./fk";
import { samplePoseAt } from "./interpolate";
import { CLIP_UPDATED_EVENT, resolveActiveClip } from "./storage";
import StickFigureRenderer from "./StickFigureRenderer";

type LoadingAnimationProps = {
  size?: number;
  color?: "white" | "black";
  className?: string;
};

const FILL_BY_COLOR = {
  white: "#ffffff",
  black: "#333333",
} as const;

export default function LoadingAnimation({
  size = 80,
  color = "white",
  className,
}: LoadingAnimationProps) {
  const [clip, setClip] = useState<AnimationClip>(() => DEFAULT_CLIP);
  const [t, setT] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const reload = () => {
      void resolveActiveClip().then((next) => {
        if (!cancelled) {
          setClip(next);
        }
      });
    };
    reload();
    window.addEventListener(CLIP_UPDATED_EVENT, reload);
    return () => {
      cancelled = true;
      window.removeEventListener(CLIP_UPDATED_EVENT, reload);
    };
  }, []);

  useEffect(() => {
    let frame = 0;
    let start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - start;
      const duration = Math.max(clip.durationMs, 1);
      const nextT = clip.loop
        ? (elapsed % duration) / duration
        : Math.min(elapsed / duration, 1);
      setT(nextT);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [clip]);

  const pose = samplePoseAt(clip, t);
  const world = computeWorldJoints(clip, pose);
  const fill = FILL_BY_COLOR[color];

  return (
    <StickFigureRenderer
      clip={clip}
      world={world}
      color={fill}
      size={size}
      className={className}
    />
  );
}
