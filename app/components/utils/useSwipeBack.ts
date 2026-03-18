import { useRef, useState } from "react";

const BACK_SWIPE_START_THRESHOLD = 1 / 3;
const BACK_SWIPE_FINISH_THRESHOLD = 2 / 3;


export default function useSwipeBack({ onBack }: { onBack: () => void }) {
    const swipeStartXRef = useRef<number>(0);
    const swipeStartYRef = useRef<number>(0);
    const thisTouchIsInvalid = useRef<boolean>(false);
    const [swipingBackPercent, setSwipingBackPercent] = useState<number | null>(null);

    const onTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
        thisTouchIsInvalid.current = true;
        const touch = event.touches[0];
        if (!touch) return;

        const parentRect = (event.target as HTMLElement)?.getBoundingClientRect();
        if (!parentRect) return;

        // Only start a swipe back if it's 1/3rd of the target width or more
        const dl = touch.clientX - parentRect.left;
        if (dl > parentRect.width * BACK_SWIPE_START_THRESHOLD) return;

        swipeStartXRef.current = touch.clientX;
        swipeStartYRef.current = touch.clientY;
        thisTouchIsInvalid.current = false;
    };

    const onTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
        if (thisTouchIsInvalid.current) return;
        const touch = event.touches[0];
        if (!touch) return;

        const parentRect = (event.target as HTMLElement)?.getBoundingClientRect();
        if (!parentRect) return;

        const touchDL = touch.clientX - swipeStartXRef.current;

        setSwipingBackPercent(Math.max(0, Math.min(1, touchDL / parentRect.width)));
    }

    const onTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
        if (thisTouchIsInvalid.current) return;
        setSwipingBackPercent(null);

        const touch = event.changedTouches[0];
        if (!touch) return;

        const parentRect = (event.target as HTMLElement)?.getBoundingClientRect();
        if (!parentRect) return;

        // Only finish a swipe if it's over half the target width
        const touchDL = touch.clientX - swipeStartXRef.current;
        if (touchDL < parentRect.width * BACK_SWIPE_FINISH_THRESHOLD) return;
        onBack();
    };

    return {
        swipingBackPercent,
        onTouchStart,
        onTouchMove,
        onTouchEnd,
    }
}