"use client";

import { useEffect, useRef, useState } from "react";
import type { SharedPostListItem, SharedPostsListResponse } from "@/app/types/interfaces";

const SEEN_STORAGE_PREFIX = "shared_event_posts_seen_v1_";
const UNREAD_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 12_000;

type SeenMap = Record<string, string>;
type InviteItem = Pick<SharedPostListItem, "id" | "is_creator" | "viewer_invited_at">;

const storageKey = (userId: string) => `${SEEN_STORAGE_PREFIX}${userId}`;

const readSeenMap = (userId: string): SeenMap => {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as SeenMap;
  } catch {
    return {};
  }
};

const writeSeenMap = (userId: string, map: SeenMap) => {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(map));
  } catch {
    // Ignore quota / private-mode failures.
  }
};

const isRecentInvite = (invitedAt: string, nowMs: number): boolean => {
  const invitedMs = Date.parse(invitedAt);
  return Number.isFinite(invitedMs) && nowMs - invitedMs <= UNREAD_MAX_AGE_MS;
};

const isUnreadInvite = (item: InviteItem, seenMap: SeenMap, nowMs: number): boolean => {
  if (item.is_creator || !item.viewer_invited_at || !isRecentInvite(item.viewer_invited_at, nowMs)) {
    return false;
  }
  const seenInvitedAt = seenMap[item.id];
  if (!seenInvitedAt) {
    return true;
  }
  const seenMs = Date.parse(seenInvitedAt);
  return !Number.isFinite(seenMs) || Date.parse(item.viewer_invited_at) > seenMs;
};

const markInvitesSeen = (userId: string, items: InviteItem[], nowMs: number) => {
  const nextMap: SeenMap = {};
  for (const item of items) {
    if (item.viewer_invited_at && isRecentInvite(item.viewer_invited_at, nowMs)) {
      nextMap[item.id] = item.viewer_invited_at;
    }
  }
  writeSeenMap(userId, nextMap);
};

/**
 * Nav unread dot for shared event invites the user hasn't opened the tab for yet
 * (localStorage-backed, 7-day window, ignores events the viewer created).
 */
export default function useSharedEventPostsUnread({
  userId,
  isTabActive,
}: {
  userId: string | null;
  isTabActive: boolean;
}): boolean {
  const [hasUnread, setHasUnread] = useState(false);
  const itemsRef = useRef<InviteItem[]>([]);
  const isTabActiveRef = useRef(isTabActive);
  isTabActiveRef.current = isTabActive;

  useEffect(() => {
    if (!userId) {
      setHasUnread(false);
      itemsRef.current = [];
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        const response = await fetch("/api/shared-posts-list", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phases: ["open", "pending", "released"] }),
        });
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as SharedPostsListResponse;
        const items = [...payload.open, ...payload.pending, ...payload.released];
        if (cancelled) {
          return;
        }

        itemsRef.current = items;
        const nowMs = Date.now();

        if (isTabActiveRef.current) {
          markInvitesSeen(userId, items, nowMs);
          setHasUnread(false);
          return;
        }

        const seenMap = readSeenMap(userId);
        setHasUnread(items.some((item) => isUnreadInvite(item, seenMap, nowMs)));
      } catch {
        // Silent failure: nav badge can remain stale until next refresh.
      }
    };

    void run();
    const intervalId = window.setInterval(() => {
      void run();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [userId]);

  useEffect(() => {
    if (!userId || !isTabActive) {
      return;
    }
    markInvitesSeen(userId, itemsRef.current, Date.now());
    setHasUnread(false);
  }, [userId, isTabActive]);

  return hasUnread;
}
