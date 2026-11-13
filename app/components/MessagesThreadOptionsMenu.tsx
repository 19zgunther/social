"use client";

import { useLayoutEffect, useState } from "react";
import { PinIcon } from "@/app/components/Icons";
import type { ThreadItem } from "@/app/types/interfaces";
import { BlurOptionsList, BlurOptionsListItem } from "@/app/ui-components";

/** Align with message-options overlay; above thread chrome. */
const OPTIONS_MENU_OVERLAY_Z = 1950;
const MENU_WIDTH_PX = 224;
const MENU_GAP_PX = 8;

type MenuAnchor = {
  left: number;
  /** Prefer anchoring above the row (matches attach-menu bottom positioning). */
  bottom?: number;
  /** Used when there isn't enough space above the row. */
  top?: number;
};

type MessagesThreadOptionsMenuProps = {
  thread: ThreadItem | null;
  /** Element that was long-pressed / right-clicked; menu anchors near it. */
  anchorEl: HTMLElement | null;
  isUpdatingPin?: boolean;
  onClose: () => void;
  onTogglePinned: (pinned: boolean) => void;
};

export default function MessagesThreadOptionsMenu({
  thread,
  anchorEl,
  isUpdatingPin = false,
  onClose,
  onTogglePinned,
}: MessagesThreadOptionsMenuProps) {
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const isOpen = Boolean(thread && anchorEl);

  useLayoutEffect(() => {
    if (!isOpen || !anchorEl) {
      setMenuAnchor(null);
      return;
    }

    const updateAnchor = () => {
      const rect = anchorEl.getBoundingClientRect();
      const left = Math.min(
        Math.max(8, rect.left),
        Math.max(8, window.innerWidth - MENU_WIDTH_PX - 8),
      );
      const placeAbove = rect.top >= 140;
      if (placeAbove) {
        setMenuAnchor({
          left,
          bottom: Math.max(8, window.innerHeight - rect.top + MENU_GAP_PX),
        });
        return;
      }
      setMenuAnchor({
        left,
        top: rect.bottom + MENU_GAP_PX,
      });
    };

    updateAnchor();
    window.addEventListener("resize", updateAnchor);
    window.addEventListener("scroll", updateAnchor, true);
    return () => {
      window.removeEventListener("resize", updateAnchor);
      window.removeEventListener("scroll", updateAnchor, true);
    };
  }, [anchorEl, isOpen]);

  if (!isOpen || !thread || !menuAnchor) {
    return null;
  }

  const isPinned = thread.user_pinned_thread === true;

  return (
    <BlurOptionsList
      open
      onClose={onClose}
      closeDisabled={isUpdatingPin}
      ariaLabel="Chat actions"
      zIndex={OPTIONS_MENU_OVERLAY_Z}
      left={menuAnchor.left}
      bottom={menuAnchor.bottom}
      top={menuAnchor.top}
    >
      <p className="truncate px-3 py-1.5 text-xs font-semibold text-muted">{thread.name}</p>
      <BlurOptionsListItem
        role="switch"
        aria-checked={isPinned}
        disabled={isUpdatingPin}
        className="justify-between"
        onClick={() => {
          onTogglePinned(!isPinned);
        }}
      >
        <span className="flex min-w-0 items-center gap-3">
          <PinIcon className="h-5 w-5 shrink-0 text-muted" aria-hidden />
          Pin
        </span>
        <span
          aria-hidden
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
            isPinned ? "bg-accent" : "bg-border"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
              isPinned ? "left-5" : "left-0.5"
            }`}
          />
        </span>
      </BlurOptionsListItem>
    </BlurOptionsList>
  );
}
