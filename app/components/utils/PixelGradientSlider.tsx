"use client";

import { useCallback, useEffect, useRef } from "react";
import { DONT_SWIPE_TABS_CLASSNAME } from "@/app/components/utils/useSwipeBack";

type PixelGradientSliderProps = {
  id?: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  /** Exact CSS color for a discrete slider value (painted per track pixel). */
  colorAt: (value: number) => string;
  className?: string;
  "aria-label"?: string;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export function PixelGradientSlider({
  id,
  min,
  max,
  value,
  onChange,
  colorAt,
  className = "",
  "aria-label": ariaLabel,
}: PixelGradientSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef(false);
  const colorAtRef = useRef(colorAt);
  colorAtRef.current = colorAt;

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

    const span = max - min;
    const getColor = colorAtRef.current;
    for (let x = 0; x < cssWidth; x += 1) {
      const t = cssWidth <= 1 ? 0 : x / (cssWidth - 1);
      const position = Math.round(min + t * span);
      ctx.fillStyle = getColor(position);
      ctx.fillRect(x, 0, 1, cssHeight);
    }
  }, [min, max]);

  useEffect(() => {
    paintTrack();
  }, [paintTrack, colorAt]);

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
      return Math.round(min + t * (max - min));
    },
    [min, max, value],
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
  const thumbColor = colorAt(clamp(value, min, max));

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
      className={`relative h-3 w-full cursor-pointer touch-none select-none overflow-visible outline-none focus-visible:ring-2 focus-visible:ring-accent-3 ${DONT_SWIPE_TABS_CLASSNAME} ${className}`}
      onPointerDown={(event) => {
        event.preventDefault();
        draggingRef.current = true;
        (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
        setFromPointer(event.clientX);
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 16 : 1;
        if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
          event.preventDefault();
          onChange(clamp(value - step, min, max));
        } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
          event.preventDefault();
          onChange(clamp(value + step, min, max));
        } else if (event.key === "Home") {
          event.preventDefault();
          onChange(min);
        } else if (event.key === "End") {
          event.preventDefault();
          onChange(max);
        }
      }}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-md border border-accent-1">
        <canvas ref={canvasRef} className="h-full w-full" aria-hidden />
      </div>
      <div
        className="pointer-events-none absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.55)]"
        style={{ left: `${ratio * 100}%`, backgroundColor: thumbColor }}
      />
    </div>
  );
}
