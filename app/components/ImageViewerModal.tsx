"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import CachedImage from "@/app/components/utils/CachedImage";
import type { ImageOverlayData } from "@/app/types/interfaces";

const MIN_SCALE = 1;
const MAX_SCALE = 5;

const getDistance = (a: React.Touch, b: React.Touch): number =>
  Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);

const getMidpoint = (a: React.Touch, b: React.Touch): { x: number; y: number } => ({
  x: (a.clientX + b.clientX) / 2,
  y: (a.clientY + b.clientY) / 2,
});

type ViewTransform = {
  scale: number;
  tx: number;
  ty: number;
};

export type ImageViewerModalProps = {
  open: boolean;
  onClose: () => void;
  signedUrl: string | null;
  imageId: string | null;
  alt?: string;
  /** Banner-style text overlay (same semantics as thread photo messages). */
  imageOverlay?: ImageOverlayData | null;
  /** When set, shows a bottom-left Reply control (e.g. Groups photo preview). */
  onReply?: () => void;
};

export default function ImageViewerModal({
  open,
  onClose,
  signedUrl,
  imageId,
  alt = "",
  imageOverlay = null,
  onReply,
}: ImageViewerModalProps) {
  const [view, setView] = useState<ViewTransform>({ scale: 1, tx: 0, ty: 0 });
  const [mounted, setMounted] = useState(false);
  const viewRef = useRef(view);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const lastDistRef = useRef<number | null>(null);
  const lastMidRef = useRef<{ x: number; y: number } | null>(null);
  const panStartRef = useRef<{
    touchX: number;
    touchY: number;
    startTx: number;
    startTy: number;
  } | null>(null);

  useEffect(() => {
    // DOM is unavailable during SSR; defer portal until after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount gate for createPortal
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    setView({ scale: 1, tx: 0, ty: 0 });
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const handleTouchStart = useCallback((event: React.TouchEvent) => {
    if (event.touches.length === 2) {
      panStartRef.current = null;
      const [t0, t1] = [event.touches[0], event.touches[1]];
      lastDistRef.current = getDistance(t0, t1);
      lastMidRef.current = getMidpoint(t0, t1);
      return;
    }

    if (event.touches.length === 1 && viewRef.current.scale > 1) {
      lastDistRef.current = null;
      lastMidRef.current = null;
      const t = event.touches[0];
      const { tx, ty } = viewRef.current;
      panStartRef.current = {
        touchX: t.clientX,
        touchY: t.clientY,
        startTx: tx,
        startTy: ty,
      };
    }
  }, []);

  const handleTouchMove = useCallback((event: React.TouchEvent) => {
    if (event.touches.length === 2) {
      event.preventDefault();
      const [t0, t1] = [event.touches[0], event.touches[1]];
      const dist = getDistance(t0, t1);
      const mid = getMidpoint(t0, t1);
      const lastDist = lastDistRef.current;
      const lastMid = lastMidRef.current;

      if (lastDist === null || lastMid === null) {
        lastDistRef.current = dist;
        lastMidRef.current = mid;
        return;
      }

      setView((previous) => {
        const ox = window.innerWidth / 2;
        const oy = window.innerHeight / 2;
        const newScale = Math.min(
          MAX_SCALE,
          Math.max(MIN_SCALE, previous.scale * (dist / lastDist)),
        );
        let newTx =
          (mid.x - ox) - (mid.x - ox - previous.tx) * (newScale / previous.scale);
        let newTy =
          (mid.y - oy) - (mid.y - oy - previous.ty) * (newScale / previous.scale);
        newTx += mid.x - lastMid.x;
        newTy += mid.y - lastMid.y;
        return { scale: newScale, tx: newTx, ty: newTy };
      });

      lastDistRef.current = dist;
      lastMidRef.current = mid;
      return;
    }

    if (event.touches.length === 1 && panStartRef.current && viewRef.current.scale > 1) {
      event.preventDefault();
      const t = event.touches[0];
      const start = panStartRef.current;
      setView((previous) => ({
        ...previous,
        tx: start.startTx + (t.clientX - start.touchX),
        ty: start.startTy + (t.clientY - start.touchY),
      }));
    }
  }, []);

  const handleTouchEnd = useCallback((event: React.TouchEvent) => {
    lastDistRef.current = null;
    lastMidRef.current = null;
    if (event.touches.length === 1 && viewRef.current.scale > 1) {
      const t = event.touches[0];
      panStartRef.current = {
        touchX: t.clientX,
        touchY: t.clientY,
        startTx: viewRef.current.tx,
        startTy: viewRef.current.ty,
      };
    } else if (event.touches.length === 0) {
      panStartRef.current = null;
    }
    setView((previous) => ({
      ...previous,
      scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, previous.scale)),
    }));
  }, []);

  const handleWheel = useCallback((event: React.WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }
    event.preventDefault();
    const delta = -event.deltaY;
    const factor = delta > 0 ? 1.06 : 1 / 1.06;
    const ox = window.innerWidth / 2;
    const oy = window.innerHeight / 2;
    const mx = event.clientX;
    const my = event.clientY;

    setView((previous) => {
      const newScale = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, previous.scale * factor),
      );
      const newTx = (mx - ox) - (mx - ox - previous.tx) * (newScale / previous.scale);
      const newTy = (my - oy) - (my - oy - previous.ty) * (newScale / previous.scale);
      return { scale: newScale, tx: newTx, ty: newTy };
    });
  }, []);

  if (!mounted || !open || !signedUrl) {
    return null;
  }

  const { scale, tx, ty } = view;

  const content = (
    <div
      className="fixed inset-0 z-[2200] touch-none bg-black"
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      onWheel={handleWheel}
    >
      <button
        type="button"
        aria-label="Close image viewer"
        onClick={onClose}
        className="absolute right-3 top-10 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white shadow-lg ring-1 ring-white/25 hover:bg-black/75"
      >
        <X className="h-6 w-6" strokeWidth={2.5} />
      </button>

      <div
        className="relative flex h-full w-full items-center justify-center overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        <div
          style={{
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
            transformOrigin: "center center",
            willChange: "transform",
          }}
          className="relative max-h-[100dvh] max-w-[100vw]"
        >
          <CachedImage
            signedUrl={signedUrl}
            imageId={imageId}
            alt={alt}
            draggable={false}
            className="max-h-[100dvh] max-w-[100vw] select-none object-contain"
          />
          {imageOverlay ? (
            <div
              className="pointer-events-none absolute left-0 right-0 -translate-y-1/2 bg-black/45 px-3 py-2 text-center text-sm font-semibold text-white"
              style={{ top: `${imageOverlay.y_ratio * 100}%` }}
            >
              {imageOverlay.text}
            </div>
          ) : null}
        </div>
      </div>

      {onReply ? (
        <button
          type="button"
          onClick={onReply}
          className="absolute bottom-6 right-4 p-4 z-10 text-sm font-medium bg-blue-400 hover:bg-blue-300 rounded-full"
        >
          Reply
        </button>
      ) : null}
    </div>
  );

  return createPortal(content, document.body);
}
