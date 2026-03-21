import { useCallback, useEffect, useRef, useState } from "react";

const EDGE_SWIPE_START_THRESHOLD = 1 / 3;
const EDGE_SWIPE_FINISH_THRESHOLD = 2 / 3;
const CANCEL_SETTLE_MS = 280;
export const DONT_SWIPE_TABS_CLASSNAME = "dont-swipe-tabs";

function easeOutCubic(t: number) {
    return 1 - Math.pow(1 - t, 3);
}

type SwipeMode = "back" | "forward";

export default function useSwipeBack({
    onBack,
    onForward,
}: {
    onBack: () => void;
    onForward?: () => void;
}) {
    const swipeStartXRef = useRef<number>(0);
    const thisTouchIsInvalid = useRef<boolean>(false);
    const swipeModeRef = useRef<SwipeMode | null>(null);
    const settleRafRef = useRef<number | null>(null);
    const latestBackPercentRef = useRef<number | null>(null);
    const latestForwardPercentRef = useRef<number | null>(null);

    const [swipingBackPercent, setSwipingBackPercent] = useState<number | null>(null);
    const [swipingForwardPercent, setSwipingForwardPercent] = useState<number | null>(null);

    const cancelSettleAnimation = useCallback(() => {
        if (settleRafRef.current !== null) {
            cancelAnimationFrame(settleRafRef.current);
            settleRafRef.current = null;
        }
    }, []);

    const animateSettleToNull = useCallback(
        (kind: SwipeMode, from: number) => {
            cancelSettleAnimation();
            if (from <= 0) {
                if (kind === "back") {
                    latestBackPercentRef.current = null;
                    setSwipingBackPercent(null);
                } else {
                    latestForwardPercentRef.current = null;
                    setSwipingForwardPercent(null);
                }
                return;
            }
            const start = performance.now();
            const step = (now: number) => {
                const t = Math.min(1, (now - start) / CANCEL_SETTLE_MS);
                const eased = easeOutCubic(t);
                const next = from * (1 - eased);
                if (t >= 1) {
                    if (kind === "back") {
                        latestBackPercentRef.current = null;
                        setSwipingBackPercent(null);
                    } else {
                        latestForwardPercentRef.current = null;
                        setSwipingForwardPercent(null);
                    }
                } else if (kind === "back") {
                    latestBackPercentRef.current = next;
                    setSwipingBackPercent(next);
                } else {
                    latestForwardPercentRef.current = next;
                    setSwipingForwardPercent(next);
                }
                if (t < 1) {
                    settleRafRef.current = requestAnimationFrame(step);
                } else {
                    settleRafRef.current = null;
                }
            };
            settleRafRef.current = requestAnimationFrame(step);
        },
        [cancelSettleAnimation]
    );

    useEffect(() => () => cancelSettleAnimation(), [cancelSettleAnimation]);

    const onTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
        thisTouchIsInvalid.current = true;
        swipeModeRef.current = null;
        const touch = event.touches[0];
        if (!touch) return;

        // get the closest DONT_SWIPE_TABS_CLASSNAME parent
        let closestDontSwipeTabs = event.target as HTMLElement;
        while (closestDontSwipeTabs && !closestDontSwipeTabs?.classList?.contains(DONT_SWIPE_TABS_CLASSNAME)) {
            closestDontSwipeTabs = closestDontSwipeTabs?.parentElement as HTMLElement;
            if (!closestDontSwipeTabs) break;
        }
        if (closestDontSwipeTabs) {
            return;
        }

        const parentRect = (event.target as HTMLElement)?.getBoundingClientRect();
        if (!parentRect) return;

        const fromLeft = touch.clientX - parentRect.left;
        const fromRight = parentRect.right - touch.clientX;
        const w = parentRect.width;

        if (fromLeft <= w * EDGE_SWIPE_START_THRESHOLD) {
            swipeModeRef.current = "back";
            swipeStartXRef.current = touch.clientX;
            thisTouchIsInvalid.current = false;
            cancelSettleAnimation();
            latestForwardPercentRef.current = null;
            setSwipingForwardPercent(null);
            return;
        }

        if (
            onForward &&
            fromRight <= w * EDGE_SWIPE_START_THRESHOLD
        ) {
            swipeModeRef.current = "forward";
            swipeStartXRef.current = touch.clientX;
            thisTouchIsInvalid.current = false;
            cancelSettleAnimation();
            latestBackPercentRef.current = null;
            setSwipingBackPercent(null);
            return;
        }
    };

    const onTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
        if (thisTouchIsInvalid.current) return;
        const mode = swipeModeRef.current;
        if (!mode) return;

        const touch = event.touches[0];
        if (!touch) return;

        const parentRect = (event.target as HTMLElement)?.getBoundingClientRect();
        if (!parentRect) return;

        const touchDL = touch.clientX - swipeStartXRef.current;
        const w = parentRect.width;

        if (mode === "back") {
            const p = Math.max(0, Math.min(1, touchDL / w));
            latestBackPercentRef.current = p;
            setSwipingBackPercent(p);
        } else {
            const p = Math.max(0, Math.min(1, -touchDL / w));
            latestForwardPercentRef.current = p;
            setSwipingForwardPercent(p);
        }
    };

    const onTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
        if (thisTouchIsInvalid.current) return;
        const mode = swipeModeRef.current;

        const touch = event.changedTouches[0];
        if (!touch) {
            if (mode === "back") {
                animateSettleToNull("back", latestBackPercentRef.current ?? 0);
            } else if (mode === "forward") {
                animateSettleToNull("forward", latestForwardPercentRef.current ?? 0);
            }
            swipeModeRef.current = null;
            return;
        }

        const parentRect = (event.target as HTMLElement)?.getBoundingClientRect();
        if (!parentRect) {
            if (mode === "back") {
                animateSettleToNull("back", latestBackPercentRef.current ?? 0);
            } else if (mode === "forward") {
                animateSettleToNull("forward", latestForwardPercentRef.current ?? 0);
            }
            swipeModeRef.current = null;
            return;
        }

        const w = parentRect.width;
        const touchDL = touch.clientX - swipeStartXRef.current;

        if (mode === "back") {
            const percent = Math.max(0, Math.min(1, touchDL / w));
            if (touchDL >= w * EDGE_SWIPE_FINISH_THRESHOLD) {
                cancelSettleAnimation();
                latestBackPercentRef.current = null;
                setSwipingBackPercent(null);
                onBack();
            } else {
                animateSettleToNull("back", percent);
            }
        } else if (mode === "forward" && onForward) {
            const percent = Math.max(0, Math.min(1, -touchDL / w));
            if (-touchDL >= w * EDGE_SWIPE_FINISH_THRESHOLD) {
                cancelSettleAnimation();
                latestForwardPercentRef.current = null;
                setSwipingForwardPercent(null);
                onForward();
            } else {
                animateSettleToNull("forward", percent);
            }
        }

        swipeModeRef.current = null;
    };

    return {
        swipingBackPercent,
        swipingForwardPercent,
        onTouchStart,
        onTouchMove,
        onTouchEnd,
    };
}
