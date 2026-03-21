"use client";

import { useEffect, useState } from "react";

export type UserSessionSyncState = {
  lastActiveByUserId: Record<string, number | null>;
  nowMs: number;
};

/**
 * Keeps this client's session row fresh and polls accepted friends' `user_sessions.updated_at`.
 * `nowMs` ticks every second so presence rings can decay without waiting on network.
 */
export function useUserSessionSync(currentUserId: string): UserSessionSyncState {
  const [lastActiveByUserId, setLastActiveByUserId] = useState<Record<string, number | null>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const sync = async () => {
      try {
        const response = await fetch("/api/user-session-sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as {
          last_active_by_user_id?: Record<string, string>;
        };
        const next: Record<string, number | null> = {};
        for (const [friendId, iso] of Object.entries(payload.last_active_by_user_id ?? {})) {
          const parsed = Date.parse(iso);
          next[friendId] = Number.isNaN(parsed) ? null : parsed;
        }
        next[currentUserId] = Date.now();
        if (!cancelled) {
          setLastActiveByUserId(next);
        }
      } catch {
        // Keep last known map until the next interval.
      }
    };

    void sync();
    const intervalId = window.setInterval(() => {
      void sync();
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [currentUserId]);

  return { lastActiveByUserId, nowMs };
}

/** Presence sync hook (same as `useUserSessionSync`). */
export const userSessionSync = useUserSessionSync;
