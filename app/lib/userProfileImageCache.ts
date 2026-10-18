"use client";

import type {
  UserProfileImageEntry,
  UserProfileImagesResponse,
} from "@/app/types/interfaces";

/** How long a resolved profile image entry may be reused without contacting the server. */
export const USER_PROFILE_IMAGE_CACHE_TTL_MS = 60 * 60 * 1000;

/** Must match server `MAX_USER_IDS` on `/api/user-profile-images`. */
const MAX_BATCH_SIZE = 50;

/** HTTP attempts per batch before backing off. */
const MAX_FETCH_ATTEMPTS = 3;

/** Backoff between in-batch retries (ms). */
const RETRY_DELAYS_MS = [400, 1500];

/**
 * After a batch exhausts in-batch retries, wait this long before another cycle.
 * Caps runaway loops together with `MAX_FLUSH_CYCLES`.
 */
const COOLDOWN_AFTER_FLUSH_FAILURE_MS = 5_000;

/** Max failed flush cycles per user id before we stop until a later ensure + cooldown. */
const MAX_FLUSH_CYCLES = 3;

type CacheRow = {
  entry: UserProfileImageEntry;
  fetched_at_ms: number;
};

type AttemptRow = {
  cycles: number;
  lastFailedAtMs: number;
};

const memoryCache = new Map<string, CacheRow>();
const attemptsByUserId = new Map<string, AttemptRow>();
const listeners = new Set<() => void>();

let pendingUserIds = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let scheduledDelayMs = 0;
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

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

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
  attemptsByUserId.delete(trimmed);
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
    attemptsByUserId.delete(userId);
  }
  notify();
};

/** One POST; returns resolved ids on success, null on transport/HTTP failure. */
const fetchProfilesOnce = async (
  userIds: string[],
): Promise<Set<string> | null> => {
  if (userIds.length === 0) {
    return new Set();
  }
  try {
    const response = await fetch("/api/user-profile-images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_ids: userIds }),
    });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as UserProfileImagesResponse;
    if (!payload.profiles || typeof payload.profiles !== "object") {
      return null;
    }
    writeProfiles(payload.profiles);
    return new Set(Object.keys(payload.profiles));
  } catch {
    return null;
  }
};

type BatchFetchResult =
  | { ok: true; missing: string[] }
  | { ok: false; userIds: string[] };

/** Fetch a batch with capped in-batch retries. */
const fetchProfilesWithRetry = async (userIds: string[]): Promise<BatchFetchResult> => {
  for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS; attempt++) {
    const resolved = await fetchProfilesOnce(userIds);
    if (resolved) {
      return {
        ok: true,
        missing: userIds.filter((id) => !resolved.has(id)),
      };
    }
    if (attempt < MAX_FETCH_ATTEMPTS - 1) {
      await sleep(RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]);
    }
  }
  return { ok: false, userIds };
};

const takeBatch = (): string[] => {
  const batch: string[] = [];
  for (const userId of pendingUserIds) {
    batch.push(userId);
    pendingUserIds.delete(userId);
    if (batch.length >= MAX_BATCH_SIZE) {
      break;
    }
  }
  return batch;
};

const requeue = (userIds: string[]) => {
  for (const userId of userIds) {
    pendingUserIds.add(userId);
  }
};

/** Schedule a flush; a sooner delay wins over an already-scheduled later one. */
const scheduleFlush = (delayMs = 0) => {
  if (flushTimer !== null) {
    if (delayMs >= scheduledDelayMs) {
      return;
    }
    clearTimeout(flushTimer);
  }
  scheduledDelayMs = delayMs;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    scheduledDelayMs = 0;
    flushPending();
  }, delayMs);
};

/** Re-queue failed ids after cooldown so they don't starve a waiting overflow batch. */
const requeueAfterCooldown = (userIds: string[]) => {
  setTimeout(() => {
    const now = Date.now();
    let added = false;
    for (const userId of userIds) {
      if (isFresh(memoryCache.get(userId), now)) {
        continue;
      }
      if (!canEnqueue(userId, now)) {
        continue;
      }
      if (!pendingUserIds.has(userId)) {
        pendingUserIds.add(userId);
        added = true;
      }
    }
    if (added || pendingUserIds.size > 0) {
      scheduleFlush(0);
    }
  }, COOLDOWN_AFTER_FLUSH_FAILURE_MS);
};

const flushPending = () => {
  if (inFlight) {
    return;
  }

  const batch = takeBatch();
  if (batch.length === 0) {
    return;
  }

  const run = fetchProfilesWithRetry(batch)
    .then((result) => {
      if (result.ok) {
        // Server may cull past MAX_BATCH_SIZE; fetch the rest on the next wave.
        if (result.missing.length > 0) {
          requeue(result.missing);
        }
        return;
      }

      const now = Date.now();
      const retryable: string[] = [];
      for (const userId of result.userIds) {
        const prev = attemptsByUserId.get(userId);
        const cycles = (prev?.cycles ?? 0) + 1;
        attemptsByUserId.set(userId, { cycles, lastFailedAtMs: now });
        if (cycles < MAX_FLUSH_CYCLES) {
          retryable.push(userId);
        }
      }
      if (retryable.length > 0) {
        requeueAfterCooldown(retryable);
      }
    })
    .finally(() => {
      if (inFlight === run) {
        inFlight = null;
      }
      // Overflow from >MAX_BATCH_SIZE (or culled missing) — continue immediately.
      if (pendingUserIds.size > 0) {
        scheduleFlush(0);
      }
    });

  inFlight = run;
};

const canEnqueue = (userId: string, now: number): boolean => {
  const row = attemptsByUserId.get(userId);
  if (!row || row.cycles < MAX_FLUSH_CYCLES) {
    return true;
  }
  if (now - row.lastFailedAtMs < COOLDOWN_AFTER_FLUSH_FAILURE_MS) {
    return false;
  }
  // Allow a fresh cycle after cooldown (e.g. user navigated back to a list).
  attemptsByUserId.delete(userId);
  return true;
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
    if (!canEnqueue(userId, now)) {
      continue;
    }
    if (!pendingUserIds.has(userId)) {
      pendingUserIds.add(userId);
      added = true;
    }
  }
  if (added) {
    scheduleFlush(0);
  }
};
