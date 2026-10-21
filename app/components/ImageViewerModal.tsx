"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "@/app/components/Icons";
import CachedImage from "@/app/components/utils/CachedImage";
import type { ImageOverlayData } from "@/app/types/interfaces";
import { DONT_SWIPE_TABS_CLASSNAME } from "@/app/components/utils/useSwipeBack";

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const SWIPE_DISMISS_THRESHOLD_PX = 120;
const SWIPE_NAVIGATE_THRESHOLD_PX = 150;
const EDGE_NAVIGATE_THRESHOLD_PX = 110;
const NAV_SETTLE_MS = 210;

const getDistance = (a: Touch, b: Touch): number =>
  Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);

const getMidpoint = (a: Touch, b: Touch): { x: number; y: number } => ({
  x: (a.clientX + b.clientX) / 2,
  y: (a.clientY + b.clientY) / 2,
});

// How far the scaled photo can move before its edge reaches the viewport edge;
// dragging beyond this is what pulls in the next photo.
const clampPan = (
  tx: number,
  ty: number,
  scale: number,
  baseWidth: number,
  baseHeight: number,
): { tx: number; ty: number } => {
  if (scale <= MIN_SCALE) {
    return { tx: 0, ty: 0 };
  }
  const maxTx = Math.max(0, (baseWidth * scale - window.innerWidth) / 2);
  const maxTy = Math.max(0, (baseHeight * scale - window.innerHeight) / 2);
  return {
    tx: Math.min(maxTx, Math.max(-maxTx, tx)),
    ty: Math.min(maxTy, Math.max(-maxTy, ty)),
  };
};

type ViewTransform = { scale: number; tx: number; ty: number };

export type ImageViewerImage = {
  imageId: string | null;
  signedUrl?: string | null;
  imageAccessGrant?: string | null;
  imageStorageUserId?: string | null;
  imageThreadId?: string | null;
  alt?: string;
  imageOverlay?: ImageOverlayData | null;
};

export type ImageViewerModalProps = {
  open: boolean;
  onClose: () => void;
  signedUrl?: string | null;
  imageId: string | null;
  imageAccessGrant?: string | null;
  imageStorageUserId?: string | null;
  /** Thread-bucket image; use with `imageAccessGrant` from thread APIs. */
  imageThreadId?: string | null;
  alt?: string;
  /** Banner-style text overlay (same semantics as thread photo messages). */
  imageOverlay?: ImageOverlayData | null;
  /** When set, shows a bottom-left Reply control (e.g. Groups photo preview). */
  onReply?: () => void;
  /** Photo queue to swipe through; takes precedence over the single-image props.
   * On a zoomed image, dragging past its edge pulls in the neighbouring photo. */
  images?: ImageViewerImage[];
  /** Index into `images` to show first. Only read when the viewer opens. */
  initialIndex?: number;
  onIndexChange?: (index: number) => void;
};

function ViewerImage({ image, fallbackAlt }: { image: ImageViewerImage; fallbackAlt: string }) {
  return (
    <CachedImage
      signedUrl={image.signedUrl ?? null}
      imageId={image.imageId}
      imageAccessGrant={image.imageAccessGrant ?? null}
      imageStorageUserId={image.imageStorageUserId ?? null}
      imageThreadId={image.imageThreadId ?? null}
      alt={image.alt ?? fallbackAlt}
      draggable={false}
      className="max-h-[100dvh] max-w-[100vw] select-none object-contain"
    />
  );
}

export default function ImageViewerModal({
  open,
  onClose,
  signedUrl = null,
  imageId,
  imageAccessGrant = null,
  imageStorageUserId = null,
  imageThreadId = null,
  alt = "",
  imageOverlay = null,
  onReply,
  images: imagesProp,
  initialIndex = 0,
  onIndexChange,
}: ImageViewerModalProps) {
  const images: ImageViewerImage[] =
    imagesProp && imagesProp.length > 0
      ? imagesProp
      : imageId || signedUrl
        ? [{ imageId, signedUrl, imageAccessGrant, imageStorageUserId, imageThreadId, alt, imageOverlay }]
        : [];

  const [index, setIndex] = useState(initialIndex);
  const [view, setView] = useState<ViewTransform>({ scale: 1, tx: 0, ty: 0 });
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isSwipeDragging, setIsSwipeDragging] = useState(false);
  // Suppresses the transform transition for the swap frame, so the incoming
  // photo doesn't animate in from the outgoing photo's side.
  const [isInstantReset, setIsInstantReset] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [touchArea, setTouchArea] = useState<HTMLDivElement | null>(null);

  const viewRef = useRef(view);
  const dragOffsetRef = useRef(dragOffset);
  const imageWrapRef = useRef<HTMLDivElement>(null);
  const lastDistRef = useRef<number | null>(null);
  const lastMidRef = useRef<{ x: number; y: number } | null>(null);
  const gestureStartRef = useRef<{ x: number; y: number; startTx: number; startTy: number } | null>(null);
  const gestureAxisRef = useRef<"vertical" | "horizontal" | null>(null);
  const navSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navSettleFrameRef = useRef<number | null>(null);
  const isNavSettlingRef = useRef(false);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const currentIndex = images.length > 0 ? Math.min(Math.max(index, 0), images.length - 1) : 0;
  const currentImage = images[currentIndex];
  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex < images.length - 1;

  const clampViewPan = useCallback((tx: number, ty: number, scale: number) => {
    const wrap = imageWrapRef.current;
    return clampPan(tx, ty, scale, wrap?.offsetWidth || window.innerWidth, wrap?.offsetHeight || window.innerHeight);
  }, []);

  const setDrag = useCallback((x: number, y: number) => {
    dragOffsetRef.current = { x, y };
    setDragOffset(dragOffsetRef.current);
  }, []);

  const resetDrag = useCallback(() => {
    setDrag(0, 0);
    setIsSwipeDragging(false);
  }, [setDrag]);

  const cancelNavSettle = useCallback(() => {
    if (navSettleTimerRef.current !== null) {
      clearTimeout(navSettleTimerRef.current);
      navSettleTimerRef.current = null;
    }
    if (navSettleFrameRef.current !== null) {
      cancelAnimationFrame(navSettleFrameRef.current);
      navSettleFrameRef.current = null;
    }
    isNavSettlingRef.current = false;
  }, []);

  const showIndex = useCallback(
    (nextIndex: number) => {
      setIndex(nextIndex);
      setView({ scale: 1, tx: 0, ty: 0 });
      onIndexChange?.(nextIndex);
    },
    [onIndexChange],
  );

  const goToIndex = useCallback(
    (nextIndex: number) => {
      cancelNavSettle();
      resetDrag();
      if (nextIndex >= 0 && nextIndex < images.length && nextIndex !== currentIndex) {
        showIndex(nextIndex);
      }
    },
    [cancelNavSettle, currentIndex, images.length, resetDrag, showIndex],
  );

  // Finish a swipe in its drag direction, then swap index/offset with the
  // transition suppressed — swapping sooner animates in from the wrong side.
  const settleToNeighbour = useCallback(
    (nextIndex: number) => {
      if (nextIndex < 0 || nextIndex >= images.length || nextIndex === currentIndex) {
        resetDrag();
        return;
      }
      isNavSettlingRef.current = true;
      setDrag((currentIndex - nextIndex) * window.innerWidth, 0);
      setIsSwipeDragging(false);
      navSettleTimerRef.current = setTimeout(() => {
        navSettleTimerRef.current = null;
        isNavSettlingRef.current = false;
        setIsInstantReset(true);
        showIndex(nextIndex);
        resetDrag();
        navSettleFrameRef.current = requestAnimationFrame(() => {
          navSettleFrameRef.current = requestAnimationFrame(() => {
            navSettleFrameRef.current = null;
            setIsInstantReset(false);
          });
        });
      }, NAV_SETTLE_MS);
    },
    [currentIndex, images.length, resetDrag, setDrag, showIndex],
  );

  useEffect(() => {
    // DOM is unavailable during SSR; defer portal until after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount gate for createPortal
    setMounted(true);
  }, []);

  useEffect(() => cancelNavSettle, [cancelNavSettle]);

  useEffect(() => {
    if (!open) {
      return;
    }
    cancelNavSettle();
    setIndex(Math.min(Math.max(initialIndex, 0), Math.max(images.length - 1, 0)));
    setView({ scale: 1, tx: 0, ty: 0 });
    resetDrag();
    gestureStartRef.current = null;
    gestureAxisRef.current = null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
    // Only re-initialise when the viewer (re)opens; `initialIndex`/`images`
    // are intentionally not deps so queue updates and index sync from the
    // parent while open don't snap the viewer back to the first photo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cancelNavSettle, resetDrag]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "ArrowLeft") {
        goToIndex(currentIndex - 1);
      } else if (event.key === "ArrowRight") {
        goToIndex(currentIndex + 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentIndex, goToIndex, open, onClose]);

  const handleTouchStart = useCallback(
    (event: TouchEvent) => {
      if (isNavSettlingRef.current) {
        return;
      }
      if (event.touches.length === 2) {
        gestureStartRef.current = null;
        gestureAxisRef.current = null;
        setIsSwipeDragging(false);
        const [t0, t1] = [event.touches[0], event.touches[1]];
        lastDistRef.current = getDistance(t0, t1);
        lastMidRef.current = getMidpoint(t0, t1);
        return;
      }
      if (event.touches.length === 1) {
        lastDistRef.current = null;
        lastMidRef.current = null;
        const t = event.touches[0];
        gestureStartRef.current = {
          x: t.clientX,
          y: t.clientY,
          startTx: viewRef.current.tx,
          startTy: viewRef.current.ty,
        };
        gestureAxisRef.current = null;
        resetDrag();
      }
    },
    [resetDrag],
  );

  const handleTouchMove = useCallback(
    (event: TouchEvent) => {
      if (isNavSettlingRef.current) {
        return;
      }
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
          const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, previous.scale * (dist / lastDist)));
          const rawTx = mid.x - ox - (mid.x - ox - previous.tx) * (newScale / previous.scale) + (mid.x - lastMid.x);
          const rawTy = mid.y - oy - (mid.y - oy - previous.ty) * (newScale / previous.scale) + (mid.y - lastMid.y);
          const clamped = clampViewPan(rawTx, rawTy, newScale);
          return { scale: newScale, tx: clamped.tx, ty: clamped.ty };
        });
        lastDistRef.current = dist;
        lastMidRef.current = mid;
        return;
      }

      const start = gestureStartRef.current;
      if (event.touches.length !== 1 || !start) {
        return;
      }
      const t = event.touches[0];

      if (viewRef.current.scale > 1) {
        event.preventDefault();
        const scale = viewRef.current.scale;
        const rawTx = start.startTx + (t.clientX - start.x);
        const rawTy = start.startTy + (t.clientY - start.y);
        const clamped = clampViewPan(rawTx, rawTy, scale);
        setView({ scale, tx: clamped.tx, ty: clamped.ty });
        // Past the zoomed photo's edge, turn the leftover drag into a
        // pull on the neighbouring photo instead of panning further.
        const excessX = rawTx - clamped.tx;
        const pullX = (excessX < 0 && hasNext) || (excessX > 0 && hasPrevious) ? excessX : 0;
        setDrag(pullX, 0);
        setIsSwipeDragging(pullX !== 0);
        return;
      }

      const deltaX = t.clientX - start.x;
      const deltaY = t.clientY - start.y;
      if (gestureAxisRef.current === null) {
        if (Math.abs(deltaX) < 6 && Math.abs(deltaY) < 6) {
          return;
        }
        if (Math.abs(deltaY) > Math.abs(deltaX) * 1.1) {
          gestureAxisRef.current = "vertical";
        } else if (Math.abs(deltaX) > Math.abs(deltaY) * 1.1) {
          gestureAxisRef.current = "horizontal";
        } else {
          return;
        }
      }
      event.preventDefault();
      setIsSwipeDragging(true);
      if (gestureAxisRef.current === "vertical") {
        setDrag(0, deltaY);
      } else {
        // Dragging past either end gets resistance instead of empty space.
        const blocked = (deltaX < 0 && !hasNext) || (deltaX > 0 && !hasPrevious);
        setDrag(blocked ? deltaX / 3 : deltaX, 0);
      }
    },
    [clampViewPan, hasNext, hasPrevious, setDrag],
  );

  const handleTouchEnd = useCallback(
    (event: TouchEvent) => {
      if (isNavSettlingRef.current) {
        return;
      }
      lastDistRef.current = null;
      lastMidRef.current = null;

      if (event.touches.length === 0 && gestureStartRef.current) {
        const axis = gestureAxisRef.current;
        const { x: offsetX, y: offsetY } = dragOffsetRef.current;
        gestureStartRef.current = null;
        gestureAxisRef.current = null;
        if (viewRef.current.scale <= 1) {
          if (axis === "vertical" && Math.abs(offsetY) >= SWIPE_DISMISS_THRESHOLD_PX) {
            resetDrag();
            onClose();
          } else if (axis === "horizontal" && Math.abs(offsetX) >= SWIPE_NAVIGATE_THRESHOLD_PX) {
            settleToNeighbour(currentIndex + (offsetX < 0 ? 1 : -1));
          } else {
            resetDrag();
          }
        } else if (Math.abs(offsetX) >= EDGE_NAVIGATE_THRESHOLD_PX) {
          // Zoomed photo was dragged past its edge: finish the pull through
          // to the neighbouring photo, or let it snap back to the edge.
          settleToNeighbour(currentIndex + (offsetX < 0 ? 1 : -1));
        } else {
          resetDrag();
        }
        return;
      }

      if (event.touches.length === 1 && viewRef.current.scale > 1) {
        const t = event.touches[0];
        gestureStartRef.current = {
          x: t.clientX,
          y: t.clientY,
          startTx: viewRef.current.tx,
          startTy: viewRef.current.ty,
        };
      } else if (event.touches.length === 0) {
        gestureStartRef.current = null;
        gestureAxisRef.current = null;
        resetDrag();
      }
      setView((previous) => {
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, previous.scale));
        const clamped = clampViewPan(previous.tx, previous.ty, scale);
        return { scale, tx: clamped.tx, ty: clamped.ty };
      });
    },
    [clampViewPan, currentIndex, onClose, resetDrag, settleToNeighbour],
  );

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }
      event.preventDefault();
      const factor = -event.deltaY > 0 ? 1.06 : 1 / 1.06;
      const ox = window.innerWidth / 2;
      const oy = window.innerHeight / 2;
      setView((previous) => {
        const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, previous.scale * factor));
        const rawTx = event.clientX - ox - (event.clientX - ox - previous.tx) * (newScale / previous.scale);
        const rawTy = event.clientY - oy - (event.clientY - oy - previous.ty) * (newScale / previous.scale);
        const clamped = clampViewPan(rawTx, rawTy, newScale);
        return { scale: newScale, tx: clamped.tx, ty: clamped.ty };
      });
    },
    [clampViewPan],
  );

  // Native non-passive listeners instead of React props: React attaches touch/wheel
  // handlers as passive, so preventDefault() would be ignored and logged per move.
  useEffect(() => {
    if (!touchArea) {
      return;
    }
    touchArea.addEventListener("touchstart", handleTouchStart, { passive: false });
    touchArea.addEventListener("touchmove", handleTouchMove, { passive: false });
    touchArea.addEventListener("touchend", handleTouchEnd, { passive: false });
    touchArea.addEventListener("touchcancel", handleTouchEnd, { passive: false });
    touchArea.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      touchArea.removeEventListener("touchstart", handleTouchStart);
      touchArea.removeEventListener("touchmove", handleTouchMove);
      touchArea.removeEventListener("touchend", handleTouchEnd);
      touchArea.removeEventListener("touchcancel", handleTouchEnd);
      touchArea.removeEventListener("wheel", handleWheel);
    };
  }, [touchArea, handleTouchStart, handleTouchMove, handleTouchEnd, handleWheel]);

  if (!mounted || !open || !currentImage || (!currentImage.imageId && !currentImage.signedUrl)) {
    return null;
  }

  const { scale, tx, ty } = view;
  const backdropOpacity = Math.max(0.35, 1 - Math.abs(dragOffset.y) / 320);
  // A zoomed photo stays pinned to its edge while the neighbour is pulled
  // in; at scale 1 the current photo travels with the finger.
  const currentOffsetX = scale > 1 ? 0 : dragOffset.x;
  const neighbourDirection = dragOffset.x < 0 ? 1 : dragOffset.x > 0 ? -1 : 0;
  const neighbourImage = neighbourDirection !== 0 ? images[currentIndex + neighbourDirection] : undefined;
  const currentOverlay = currentImage.imageOverlay ?? imageOverlay;
  const transitionSuppressed = isSwipeDragging || isInstantReset;

  const content = (
    <div
      className={`fixed inset-0 z-[2200] touch-none ${DONT_SWIPE_TABS_CLASSNAME}`}
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      style={{ backgroundColor: `rgba(0, 0, 0, ${backdropOpacity})` }}
    >
      <button
        type="button"
        aria-label="Close image viewer"
        onClick={onClose}
        className="absolute right-3 top-10 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white shadow-lg ring-1 ring-white/25 hover:bg-black/75"
      >
        <CloseIcon className="h-6 w-6" strokeWidth={2.5} />
      </button>

      <div ref={setTouchArea} className="relative flex h-full w-full items-center justify-center overflow-hidden">
        {neighbourImage ? (
          <div
            aria-hidden
            // Above the current photo, on an opaque backdrop: a zoomed photo fills
            // the viewport, so a neighbour underneath it would stay hidden until the
            // swap. Sliding over it gives the preview and settle animation.
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black"
            style={{
              transform: `translateX(calc(${neighbourDirection * 100}vw + ${dragOffset.x}px))`,
              transition: transitionSuppressed ? undefined : "transform 200ms ease-out",
              boxShadow: neighbourDirection > 0 ? "-16px 0 32px rgba(0, 0, 0, 0.5)" : "16px 0 32px rgba(0, 0, 0, 0.5)",
            }}
          >
            <ViewerImage image={neighbourImage} fallbackAlt={alt} />
          </div>
        ) : null}

        <div
          ref={imageWrapRef}
          style={{
            transform: `translate(${tx + currentOffsetX}px, ${ty + dragOffset.y}px) scale(${scale})`,
            transformOrigin: "center center",
            willChange: "transform",
          }}
          className={`relative max-h-[100dvh] max-w-[100vw] ${transitionSuppressed ? "" : "transition-transform duration-200 ease-out"}`}
        >
          <ViewerImage image={currentImage} fallbackAlt={alt} />
          {currentOverlay ? (
            <div
              className="pointer-events-none absolute left-0 right-0 -translate-y-1/2 bg-black/45 px-3 py-2 text-center text-sm font-semibold text-white"
              style={{ top: `${currentOverlay.y_ratio * 100}%` }}
            >
              {currentOverlay.text}
            </div>
          ) : null}
        </div>
      </div>

      {images.length > 1 ? (
        <>
          <div className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5">
            {images.map((queueImage, queueIndex) => (
              <button
                key={`${queueImage.imageId ?? queueIndex}-${queueIndex}`}
                type="button"
                aria-label={`Go to photo ${queueIndex + 1}`}
                onClick={() => goToIndex(queueIndex)}
                className={`h-1.5 rounded-full transition-all ${queueIndex === currentIndex ? "w-4 bg-white" : "w-1.5 bg-white/40"}`}
              />
            ))}
          </div>
        </>
      ) : null}

      {onReply ? (
        <button
          type="button"
          onClick={onReply}
          className="absolute bottom-6 right-4 p-4 z-10 text-sm font-medium bg-accent hover:brightness-110 rounded-full"
        >
          Reply
        </button>
      ) : null}
    </div>
  );

  return createPortal(content, document.body);
}
