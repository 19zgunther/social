"use client";

import { useCallback, useEffect, useRef } from "react";
import { DONT_SWIPE_TABS_CLASSNAME } from "@/app/components/utils/useSwipeBack";

type TriangleThicknessSliderProps = {
  id?: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  className?: string;
  "aria-label"?: string;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const snapToStep = (value: number, min: number, max: number, step: number): number => {
  if (step <= 0) {
    return clamp(value, min, max);
  }
  const snapped = Math.round((value - min) / step) * step + min;
  // Avoid float drift (e.g. 0.01 * n)
  const decimals = Math.min(6, (String(step).split(".")[1] ?? "").length);
  const rounded = Number(snapped.toFixed(decimals));
  return clamp(rounded, min, max);
};

export function TriangleThicknessSlider({
  id,
  min,
  max,
  step = 0.01,
  value,
  onChange,
  className = "",
  "aria-label": ariaLabel,
}: TriangleThicknessSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef(false);

  const paintTrack = useCallback(() => {
    const track = trackRef.current;
    const canvas = canvasRef.current;
    if (!track || !canvas) {
      return;
    }

    const rect = track.getBoundingClientRect();
    const cssWidth = Math.max(1, Math.round(rect.width));
    const cssHeight = Math.max(1, Math.round(rect.height));
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    // Right triangle: thin tip on the left, full height on the right.
    ctx.fillStyle = getComputedStyle(track).color;
    ctx.beginPath();
    ctx.moveTo(0, cssHeight);
    ctx.lineTo(cssWidth, 0);
    ctx.lineTo(cssWidth, cssHeight);
    ctx.closePath();
    ctx.fill();
  }, []);

  useEffect(() => {
    paintTrack();
  }, [paintTrack]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      paintTrack();
    });
    observer.observe(track);
    return () => observer.disconnect();
  }, [paintTrack]);

  const valueFromClientX = useCallback(
    (clientX: number): number => {
      const track = trackRef.current;
      if (!track) {
        return value;
      }
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) {
        return value;
      }
      const t = clamp((clientX - rect.left) / rect.width, 0, 1);
      return snapToStep(min + t * (max - min), min, max, step);
    },
    [min, max, step, value],
  );

  const setFromPointer = useCallback(
    (clientX: number) => {
      onChange(valueFromClientX(clientX));
    },
    [onChange, valueFromClientX],
  );

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (!draggingRef.current) {
        return;
      }
      event.preventDefault();
      setFromPointer(event.clientX);
    };

    const onPointerUp = () => {
      draggingRef.current = false;
    };

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [setFromPointer]);

  const ratio = max === min ? 0 : (clamp(value, min, max) - min) / (max - min);

  return (
    <div
      ref={trackRef}
      id={id}
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      className={`relative h-3 w-full cursor-pointer touch-none select-none overflow-visible text-accent-2 outline-none focus-visible:ring-2 focus-visible:ring-accent-3 ${DONT_SWIPE_TABS_CLASSNAME} ${className}`}
      onPointerDown={(event) => {
        event.preventDefault();
        draggingRef.current = true;
        (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
        setFromPointer(event.clientX);
      }}
      onKeyDown={(event) => {
        const keyStep = event.shiftKey ? step * 10 : step;
        if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
          event.preventDefault();
          onChange(snapToStep(value - keyStep, min, max, step));
        } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
          event.preventDefault();
          onChange(snapToStep(value + keyStep, min, max, step));
        } else if (event.key === "Home") {
          event.preventDefault();
          onChange(min);
        } else if (event.key === "End") {
          event.preventDefault();
          onChange(max);
        }
      }}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-md border border-accent-1 bg-secondary-background">
        <canvas ref={canvasRef} className="h-full w-full" aria-hidden />
      </div>
      <div
        className="pointer-events-none absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent-2 shadow-[0_0_0_1px_rgba(0,0,0,0.55)]"
        style={{ left: `${ratio * 100}%` }}
      />
    </div>
  );
}
