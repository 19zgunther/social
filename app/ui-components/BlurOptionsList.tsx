"use client";

import {
  useEffect,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn";

const DEFAULT_OVERLAY_Z = 1900;
/** Must match `DONT_SWIPE_TABS_CLASSNAME` in useSwipeBack. */
const DONT_SWIPE_TABS_CLASSNAME = "dont-swipe-tabs";

export type BlurOptionsListProps = {
  open: boolean;
  onClose: () => void;
  /** When true, Escape / backdrop will not close the menu. */
  closeDisabled?: boolean;
  ariaLabel: string;
  zIndex?: number;
  left: number;
  /** Distance from viewport bottom to the menu's bottom edge. */
  bottom?: number;
  /** Distance from viewport top to the menu's top edge. */
  top?: number;
  /**
   * If set, backdrop only covers from the top of the viewport down to this
   * distance from the bottom (e.g. stop above a trigger button).
   * Omit for a full-screen backdrop.
   */
  backdropBottom?: number;
  children: ReactNode;
  panelClassName?: string;
};

export default function BlurOptionsList({
  open,
  onClose,
  closeDisabled = false,
  ariaLabel,
  zIndex = DEFAULT_OVERLAY_Z,
  left,
  bottom,
  top,
  backdropBottom,
  children,
  panelClassName,
}: BlurOptionsListProps) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: WindowEventMap["keydown"]) => {
      if (event.key === "Escape" && !closeDisabled) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeDisabled, onClose, open]);

  if (!open) {
    return null;
  }

  const panelStyle: CSSProperties = {
    left,
    ...(bottom !== undefined ? { bottom } : null),
    ...(top !== undefined ? { top } : null),
  };

  const backdropStyle: CSSProperties | undefined =
    backdropBottom !== undefined ? { bottom: backdropBottom } : undefined;

  return createPortal(
    <div
      className={`${DONT_SWIPE_TABS_CLASSNAME} pointer-events-none fixed inset-0`}
      style={{ zIndex }}
    >
      <button
        type="button"
        className={cn(
          "pointer-events-auto absolute bg-black/35 backdrop-blur-md",
          backdropBottom !== undefined ? "inset-x-0 top-0" : "inset-0",
        )}
        style={backdropStyle}
        aria-label={`Close ${ariaLabel}`}
        disabled={closeDisabled}
        onClick={() => {
          if (!closeDisabled) {
            onClose();
          }
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className={cn(
          "blur-options-list-in pointer-events-auto absolute flex w-56 origin-bottom-left flex-col gap-1 rounded-2xl p-2 shadow-lg",
          panelClassName,
        )}
        style={panelStyle}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export type BlurOptionsListItemProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
};

/** Standard row button inside a BlurOptionsList panel. */
export function BlurOptionsListItem({
  className,
  type = "button",
  children,
  ...rest
}: BlurOptionsListItemProps) {
  return (
    <button
      type={type}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-foreground transition hover:bg-bg disabled:opacity-60",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
