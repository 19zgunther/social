"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  type TouchEvent,
} from "react";
import type { AppTab } from "@/app/components/utils";

export const DONT_SWIPE_TABS_CLASSNAME = "dont-swipe-tabs";

export const TAB_SLIDE_MS = 380;
export const TAB_SLIDE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

const EDGE_SWIPE_START_THRESHOLD = 1 / 3;
const EDGE_SWIPE_FINISH_THRESHOLD = 0.45;

/** Horizontal order for slide direction. Nested tabs sit just after their parent. */
const TAB_SLIDE_ORDER: Record<AppTab, number> = {
  feed: 0,
  messages: 1,
  thread: 1.5,
  thread_settings: 1.6,
  thread_event: 1.7,
  events: 2,
  profile: 3,
  profile_settings: 3.5,
  other_user_profile: 3.6,
  feedback: 4,
};

type SlideDirection = 1 | -1;

/**
 * One motion model for cover, uncover, and edge-drag.
 * progress 0 = resting on `from` (uncover) / settled on `to` (cover).
 * progress 1 = `from` fully off-screen (uncover) / `to` fully off-screen (cover start).
 */
type Motion = {
  from: AppTab;
  to: AppTab;
  mode: "cover" | "uncover";
  direction: SlideDirection;
  progress: number;
  /** When true, transform uses CSS transition (programmatic or settle). */
  animate: boolean;
};

export type GoToTabOptions = {
  mode?: "cover" | "uncover";
  immediate?: boolean;
  onSettled?: () => void;
};

export type TabNeighbors = {
  forward: AppTab | null;
  back: AppTab | null;
};

function slideDirection(from: AppTab, to: AppTab): SlideDirection {
  return TAB_SLIDE_ORDER[to] >= TAB_SLIDE_ORDER[from] ? 1 : -1;
}

/** Register a temporary edge-swipe back handler (e.g. nested panes). */
export function useSwipeBackOverride(
  swipeBackOverrideRef: MutableRefObject<(() => void) | null>,
  onBack: () => void,
  active: boolean,
) {
  useEffect(() => {
    if (!active) {
      return;
    }
    swipeBackOverrideRef.current = onBack;
    return () => {
      if (swipeBackOverrideRef.current === onBack) {
        swipeBackOverrideRef.current = null;
      }
    };
  }, [active, onBack, swipeBackOverrideRef]);
}

/**
 * Unified tab motion: programmatic cover/uncover + edge-swipe, one progress value.
 */
export function useTabNavigation({
  activeTab,
  setActiveTab,
  neighbors,
  onEdgeBack,
  onEdgeForward,
}: {
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  neighbors: TabNeighbors;
  onEdgeBack: () => void;
  onEdgeForward?: () => void;
}) {
  const [motion, setMotion] = useState<Motion | null>(null);

  const timeoutRef = useRef<number | null>(null);
  const settleCallbackRef = useRef<(() => void) | null>(null);
  const activeTabRef = useRef(activeTab);
  const motionRef = useRef(motion);
  const neighborsRef = useRef(neighbors);
  const onEdgeBackRef = useRef(onEdgeBack);
  const onEdgeForwardRef = useRef(onEdgeForward);

  const swipeStartXRef = useRef(0);
  const draggingRef = useRef(false);
  const dragDirectionRef = useRef<SlideDirection>(1);

  activeTabRef.current = activeTab;
  motionRef.current = motion;
  neighborsRef.current = neighbors;
  onEdgeBackRef.current = onEdgeBack;
  onEdgeForwardRef.current = onEdgeForward;

  const clearTimeoutRef = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearTimeoutRef();
    };
  }, [clearTimeoutRef]);

  const goToTab = useCallback(
    (next: AppTab, options?: GoToTabOptions) => {
      const from = activeTabRef.current;
      if (next === from && !motionRef.current) {
        options?.onSettled?.();
        return;
      }

      if (options?.immediate || from === next) {
        clearTimeoutRef();
        setMotion(null);
        setActiveTab(next);
        options?.onSettled?.();
        return;
      }

      const mode = options?.mode ?? "cover";
      const direction: SlideDirection =
        mode === "uncover" ? 1 : slideDirection(from, next);

      clearTimeoutRef();
      draggingRef.current = false;

      if (mode === "uncover") {
        setMotion({
          from,
          to: next,
          mode,
          direction,
          progress: 0,
          animate: true,
        });
        window.requestAnimationFrame(() => {
          setMotion((previous) =>
            previous?.mode === "uncover" ? { ...previous, progress: 1 } : previous,
          );
        });
        timeoutRef.current = window.setTimeout(() => {
          setActiveTab(next);
          setMotion(null);
          timeoutRef.current = null;
          options?.onSettled?.();
        }, TAB_SLIDE_MS);
        return;
      }

      setActiveTab(next);
      setMotion({
        from,
        to: next,
        mode,
        direction,
        progress: 1,
        animate: false,
      });
      settleCallbackRef.current = options?.onSettled ?? null;
    },
    [clearTimeoutRef, setActiveTab],
  );

  // Cover: mount off-screen, then CSS-transition progress 1 → 0.
  useLayoutEffect(() => {
    if (!motion || motion.mode !== "cover" || motion.animate || motion.progress !== 1) {
      return;
    }
    const rafId = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setMotion((previous) =>
          previous?.mode === "cover"
            ? { ...previous, animate: true, progress: 0 }
            : previous,
        );
      });
    });
    timeoutRef.current = window.setTimeout(() => {
      setMotion(null);
      timeoutRef.current = null;
      const settled = settleCallbackRef.current;
      settleCallbackRef.current = null;
      settled?.();
    }, TAB_SLIDE_MS);
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [motion]);

  const onTouchStart = useCallback(
    (event: TouchEvent<HTMLElement>) => {
      if (draggingRef.current || motionRef.current) {
        return;
      }
      const touch = event.touches[0];
      if (!touch) {
        return;
      }

      let node = event.target as HTMLElement | null;
      while (node && !node.classList?.contains(DONT_SWIPE_TABS_CLASSNAME)) {
        node = node.parentElement;
      }
      if (node) {
        return;
      }

      const parentRect = event.currentTarget.getBoundingClientRect();
      const fromLeft = touch.clientX - parentRect.left;
      const fromRight = parentRect.right - touch.clientX;
      const w = parentRect.width;
      const { forward, back } = neighborsRef.current;
      const from = activeTabRef.current;

      if (back && fromLeft <= w * EDGE_SWIPE_START_THRESHOLD) {
        draggingRef.current = true;
        dragDirectionRef.current = 1;
        swipeStartXRef.current = touch.clientX;
        setMotion({
          from,
          to: back,
          mode: "uncover",
          direction: 1,
          progress: 0,
          animate: false,
        });
        return;
      }

      if (forward && onEdgeForwardRef.current && fromRight <= w * EDGE_SWIPE_START_THRESHOLD) {
        draggingRef.current = true;
        dragDirectionRef.current = -1;
        swipeStartXRef.current = touch.clientX;
        setMotion({
          from,
          to: forward,
          mode: "uncover",
          direction: -1,
          progress: 0,
          animate: false,
        });
      }
    },
    [],
  );

  const onTouchMove = useCallback((event: TouchEvent<HTMLElement>) => {
    if (!draggingRef.current) {
      return;
    }
    const touch = event.touches[0];
    if (!touch) {
      return;
    }
    const w = event.currentTarget.getBoundingClientRect().width;
    const touchDL = touch.clientX - swipeStartXRef.current;
    const raw = dragDirectionRef.current * touchDL / w;
    const progress = raw <= 0 ? 0 : raw >= 1 ? 1 + (raw - 1) * 0.12 : raw;
    setMotion((previous) =>
      previous && !previous.animate ? { ...previous, progress } : previous,
    );
  }, []);

  const finishDrag = useCallback(
    (progress: number) => {
      const current = motionRef.current;
      if (!current || current.animate) {
        draggingRef.current = false;
        return;
      }

      const complete = progress >= EDGE_SWIPE_FINISH_THRESHOLD;
      const target = complete ? 1 : 0;
      draggingRef.current = false;
      setMotion({ ...current, animate: true, progress: target });

      clearTimeoutRef();
      timeoutRef.current = window.setTimeout(() => {
        timeoutRef.current = null;
        if (complete) {
          setMotion(null);
          if (current.direction === 1) {
            onEdgeBackRef.current();
          } else {
            onEdgeForwardRef.current?.();
          }
        } else {
          setMotion(null);
        }
      }, TAB_SLIDE_MS);
    },
    [clearTimeoutRef],
  );

  const onTouchEnd = useCallback(
    (event: TouchEvent<HTMLElement>) => {
      if (!draggingRef.current) {
        return;
      }
      const touch = event.changedTouches[0];
      const w = event.currentTarget.getBoundingClientRect().width;
      const touchDL = touch ? touch.clientX - swipeStartXRef.current : 0;
      const progress = Math.max(
        0,
        Math.min(1, (dragDirectionRef.current * touchDL) / w),
      );
      finishDrag(progress);
    },
    [finishDrag],
  );

  const onTouchCancel = useCallback(() => {
    if (!draggingRef.current) {
      return;
    }
    finishDrag(0);
  }, [finishDrag]);

  const getTabStyle = useCallback(
    (tab: AppTab): CSSProperties => {
      const { forward, back } = neighbors;
      const isActive = tab === activeTab;
      const inMotion = Boolean(
        motion && (tab === motion.from || tab === motion.to),
      );
      const isPeekNeighbor =
        !motion && (tab === back || tab === forward);

      if (!isActive && !inMotion && !isPeekNeighbor) {
        return { display: "none" };
      }

      if (motion) {
        const transition = motion.animate
          ? `transform ${TAB_SLIDE_MS}ms ${TAB_SLIDE_EASING}`
          : undefined;
        const offset = motion.direction * motion.progress * 100;

        if (motion.mode === "cover") {
          if (tab === motion.to) {
            return {
              zIndex: 1000,
              transform: `translate3d(${offset}%, 0, 0)`,
              transition,
              willChange: "transform",
            };
          }
          if (tab === motion.from) {
            return { zIndex: 998, display: "block" };
          }
        } else {
          if (tab === motion.from) {
            return {
              zIndex: 1000,
              display: "block",
              transform: `translate3d(${offset}%, 0, 0)`,
              transition,
              willChange: "transform",
            };
          }
          if (tab === motion.to) {
            return { zIndex: 998, display: "block" };
          }
        }
      }

      if (isActive) {
        return { zIndex: 1000 };
      }
      return { zIndex: 998 };
    },
    [activeTab, motion, neighbors],
  );

  return {
    goToTab,
    getTabStyle,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
  };
}
