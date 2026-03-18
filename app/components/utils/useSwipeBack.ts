import { useRef } from "react";


export default function useSwipeBack({ onBack }: { onBack: () => void }) {
    const swipeStartXRef = useRef<number | null>(null);
    const swipeStartYRef = useRef<number | null>(null);

    const onTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
        const touch = event.touches[0];
        if (!touch) {
            return;
        }
        swipeStartXRef.current = touch.clientX;
        swipeStartYRef.current = touch.clientY;
    };

    const onTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
        const startX = swipeStartXRef.current;
        const startY = swipeStartYRef.current;
        swipeStartXRef.current = null;
        swipeStartYRef.current = null;

        const touch = event.changedTouches[0];
        if (!touch || startX === null || startY === null) {
            return;
        }

        const deltaX = touch.clientX - startX;
        const deltaY = Math.abs(touch.clientY - startY);

        const HORIZONTAL_THRESHOLD = 60;
        const VERTICAL_TOLERANCE = 40;

        if (deltaX > HORIZONTAL_THRESHOLD && deltaY < VERTICAL_TOLERANCE) {
            onBack();
        }
    };
    return {
        onTouchStart,
        onTouchEnd,
    }
}