"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "@/app/components/Icons";
import { DONT_SWIPE_TABS_CLASSNAME } from "@/app/components/utils/useSwipeBack";
import { IconButton, cn } from "@/app/ui-components";

const ANIMATED_MODAL_CLOSE_MS = 200;

const reducedMotionCloseMs = (): number =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? 0
    : ANIMATED_MODAL_CLOSE_MS;

const subscribeNoop = () => () => {};
const clientMountedSnapshot = () => true;
const serverMountedSnapshot = () => false;

export type AnimatedModalCloseOptions = {
  onClosed?: () => void;
};

export type UseAnimatedModalResult = {
  /** True while open or playing the close animation. */
  isPresented: boolean;
  isClosing: boolean;
  /** True while open and not closing — safe for focusing / active work. */
  isActive: boolean;
  open: () => void;
  /** Starts the close animation; optional `onClosed` runs after unmount timing. */
  close: (options?: AnimatedModalCloseOptions) => void;
  /** Clears immediately with no animation (e.g. navigate away after submit). */
  dismiss: () => void;
};

export function useAnimatedModal(initialOpen = false): UseAnimatedModalResult {
  const [isOpen, setIsOpen] = useState(initialOpen);
  const [isClosing, setIsClosing] = useState(false);
  const closeTimeoutRef = useRef<number | null>(null);
  const onClosedRef = useRef<(() => void) | null>(null);

  const clearCloseTimeout = useCallback(() => {
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    onClosedRef.current = null;
  }, []);

  useEffect(() => () => clearCloseTimeout(), [clearCloseTimeout]);

  const open = useCallback(() => {
    clearCloseTimeout();
    setIsClosing(false);
    setIsOpen(true);
  }, [clearCloseTimeout]);

  const dismiss = useCallback(() => {
    clearCloseTimeout();
    setIsClosing(false);
    setIsOpen(false);
  }, [clearCloseTimeout]);

  const close = useCallback(
    (options?: AnimatedModalCloseOptions) => {
      if (!isOpen || isClosing) {
        return;
      }
      setIsClosing(true);
      onClosedRef.current = options?.onClosed ?? null;
      closeTimeoutRef.current = window.setTimeout(() => {
        closeTimeoutRef.current = null;
        setIsOpen(false);
        setIsClosing(false);
        const finished = onClosedRef.current;
        onClosedRef.current = null;
        finished?.();
      }, reducedMotionCloseMs());
    },
    [isOpen, isClosing],
  );

  return {
    isPresented: isOpen,
    isClosing,
    isActive: isOpen && !isClosing,
    open,
    close,
    dismiss,
  };
}

type AnimatedModalProps = {
  isPresented: boolean;
  isClosing?: boolean;
  onClose: () => void;
  ariaLabel: string;
  children: ReactNode;
  title?: string;
  /** Rendered between the title and close button. */
  headerActions?: ReactNode;
  hideHeader?: boolean;
  closeDisabled?: boolean;
  /** Defaults to `onClose`. */
  onEscape?: () => void;
  /** Extra classes for the fixed root (z-index, padding). Default `z-[2200] px-3`. */
  rootClassName?: string;
  /** Extra classes for the panel (size, bg). Default `max-w-md bg-bg shadow-xl`. */
  panelClassName?: string;
  /** Extra classes for the dimmed/blurred backdrop. */
  backdropClassName?: string;
};

export default function AnimatedModal({
  isPresented,
  isClosing = false,
  onClose,
  ariaLabel,
  children,
  title,
  headerActions,
  hideHeader = false,
  closeDisabled = false,
  onEscape,
  rootClassName = "z-[2200] px-3",
  panelClassName = "max-w-md bg-bg shadow-xl",
  backdropClassName,
}: AnimatedModalProps) {
  const mounted = useSyncExternalStore(
    subscribeNoop,
    clientMountedSnapshot,
    serverMountedSnapshot,
  );
  // Keep the overlay inside the visible area so iOS/Android keyboards don't cover the panel.
  const [visualViewportBox, setVisualViewportBox] = useState<{
    top: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    if (!isPresented || isClosing) {
      return;
    }
    const handleEscape = onEscape ?? onClose;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || closeDisabled) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      handleEscape();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [isPresented, isClosing, closeDisabled, onClose, onEscape]);

  useEffect(() => {
    if (!isPresented) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isPresented]);

  useEffect(() => {
    if (!isPresented) {
      setVisualViewportBox(null);
      return;
    }

    const visualViewport = window.visualViewport;
    if (!visualViewport) {
      return;
    }

    const syncVisualViewport = () => {
      setVisualViewportBox({
        top: visualViewport.offsetTop,
        height: visualViewport.height,
      });
    };

    syncVisualViewport();
    visualViewport.addEventListener("resize", syncVisualViewport);
    visualViewport.addEventListener("scroll", syncVisualViewport);
    return () => {
      visualViewport.removeEventListener("resize", syncVisualViewport);
      visualViewport.removeEventListener("scroll", syncVisualViewport);
    };
  }, [isPresented]);

  if (!mounted || !isPresented) {
    return null;
  }

  const showHeader = !hideHeader && Boolean(title);

  return createPortal(
    <div
      className={cn(
        DONT_SWIPE_TABS_CLASSNAME,
        "fixed inset-0 flex items-center justify-center py-2",
        rootClassName,
        isClosing && "pointer-events-none",
      )}
      style={
        visualViewportBox
          ? {
              top: visualViewportBox.top,
              height: visualViewportBox.height,
              bottom: "auto",
            }
          : undefined
      }
    >
      <div
        className={cn(
          isClosing ? "emoji-picker-backdrop-out" : "emoji-picker-backdrop-in",
          "absolute inset-0 bg-black/45 backdrop-blur-md",
          backdropClassName,
        )}
        onClick={closeDisabled ? undefined : () => onClose()}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className={cn(
          isClosing ? "emoji-picker-panel-out" : "emoji-picker-panel-in",
          "relative flex w-full flex-col overflow-hidden rounded-2xl border border-border",
          panelClassName,
          // Always win over caller max-heights so the keyboard-shrunk visual viewport can clamp the panel.
          "max-h-full",
        )}
        onClick={(event) => event.stopPropagation()}
      >
        {showHeader ? (
          <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 pb-2 pt-3">
            <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">{title}</h2>
            {headerActions}
            <IconButton
              type="button"
              variant="ghost"
              onClick={() => onClose()}
              disabled={closeDisabled}
              aria-label="Close"
              className="shrink-0"
            >
              <CloseIcon className="h-5 w-5" />
            </IconButton>
          </header>
        ) : null}
        {children}
      </div>
    </div>,
    document.body,
  );
}
