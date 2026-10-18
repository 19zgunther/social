"use client";

import type {
  UserProfileImageEntry,
  UserProfileImagesResponse,
} from "@/app/types/interfaces";

/** How long a resolved profile image entry may be reused without contacting the server. */
export const USER_PROFILE_IMAGE_CACHE_TTL_MS = 60 * 60 * 1000;

type CacheRow = {
  entry: UserProfileImageEntry;
  fetched_at_ms: number;
};

const memoryCache = new Map<string, CacheRow>();
const listeners = new Set<() => void>();

let pendingUserIds = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;

const notify = () => {
  for (const listener of listeners) {
    listener();
  }
};

const isFresh = (row: CacheRow | undefined, now: number): row is CacheRow => {
  if (!row) {
    return false;
  }
  return now - row.fetched_at_ms < USER_PROFILE_IMAGE_CACHE_TTL_MS;
};

export const subscribeUserProfileImageCache = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Stable cache entry for `userId`, or `undefined` if not loaded / expired. */
export const getUserProfileImageCacheEntry = (
  userId: string,
): UserProfileImageEntry | undefined => {
  const trimmed = userId.trim();
  if (!trimmed) {
    return undefined;
  }
  const row = memoryCache.get(trimmed);
  if (!isFresh(row, Date.now())) {
    return undefined;
  }
  return row.entry;
};

/** Seed / overwrite cache when the caller already has image credentials. */
export const primeUserProfileImageCache = (
  userId: string,
  entry: UserProfileImageEntry,
): void => {
  const trimmed = userId.trim();
  if (!trimmed) {
    return;
  }
  const existing = memoryCache.get(trimmed);
  if (
    existing &&
    existing.entry.profile_image_id === entry.profile_image_id &&
    existing.entry.profile_image_access_grant === entry.profile_image_access_grant &&
    isFresh(existing, Date.now())
  ) {
    return;
  }
  memoryCache.set(trimmed, {
    entry: {
      profile_image_id: entry.profile_image_id,
      profile_image_access_grant: entry.profile_image_access_grant,
    },
    fetched_at_ms: Date.now(),
  });
  notify();
};

const writeProfiles = (profiles: Record<string, UserProfileImageEntry>) => {
  const now = Date.now();
  for (const [userId, entry] of Object.entries(profiles)) {
    memoryCache.set(userId, {
      entry: {
        profile_image_id: entry.profile_image_id,
        profile_image_access_grant: entry.profile_image_access_grant,
      },
      fetched_at_ms: now,
    });
  }
  notify();
};

const fetchProfiles = async (userIds: string[]): Promise<void> => {
  if (userIds.length === 0) {
    return;
  }
  try {
    const response = await fetch("/api/user-profile-images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_ids: userIds }),
    });
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as UserProfileImagesResponse;
    if (payload.profiles && typeof payload.profiles === "object") {
      writeProfiles(payload.profiles);
    }
  } catch {
    // Leave unresolved; callers keep showing placeholder until a later retry.
  }
};

const flushPending = () => {
  flushTimer = null;
  const batch = [...pendingUserIds];
  pendingUserIds = new Set();
  if (batch.length === 0) {
    return;
  }
  const run = fetchProfiles(batch).finally(() => {
    if (inFlight === run) {
      inFlight = null;
    }
    if (pendingUserIds.size > 0) {
      scheduleFlush();
    }
  });
  inFlight = run;
};

const scheduleFlush = () => {
  if (flushTimer !== null) {
    return;
  }
  flushTimer = setTimeout(flushPending, 0);
};

/** Queue missing user ids for a coalesced batch fetch. Safe to call from render effects. */
export const ensureUserProfileImages = (userIds: string[]): void => {
  const now = Date.now();
  let added = false;
  for (const raw of userIds) {
    const userId = raw.trim();
    if (!userId) {
      continue;
    }
    if (isFresh(memoryCache.get(userId), now)) {
      continue;
    }
    pendingUserIds.add(userId);
    added = true;
  }
  if (added) {
    scheduleFlush();
  }
};
