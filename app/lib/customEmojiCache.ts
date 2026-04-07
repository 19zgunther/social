"use client";

import type { EmojiItem, EmojisListResponse, EmojisResolveResponse } from "@/app/types/interfaces";

/** How long a resolved emoji row may be reused without contacting the server. */
export const CUSTOM_EMOJI_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const DB_NAME = "social_custom_emoji_cache";
const DB_VERSION = 2;
const STORE_NAME = "emojis";

type CachedEmojiRecord = EmojiItem & {
  cached_at_ms: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;
const inFlightResolveBatches = new Map<string, Promise<Record<string, EmojiItem>>>();
/** Coalesce identical list requests only; key must include full `client_known` (sorted for stability). */
const inFlightListByKey = new Map<string, Promise<EmojisListResponse>>();

const clientKnownRequestKey = (client_known: Array<{ uuid: string; updated_at: string }>): string =>
  JSON.stringify([...client_known].sort((a, b) => a.uuid.localeCompare(b.uuid)));

const openDb = (): Promise<IDBDatabase> => {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME);
      }
      db.createObjectStore(STORE_NAME, { keyPath: "uuid" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open custom emoji cache DB."));
  });

  return dbPromise;
};

const recordToItem = (record: CachedEmojiRecord): EmojiItem => ({
  uuid: record.uuid,
  created_at: record.created_at,
  updated_at: record.updated_at,
  name: record.name,
  data_b64: record.data_b64,
});

const isFreshCache = (record: CachedEmojiRecord | undefined, now: number): boolean => {
  if (!record?.uuid || !record.data_b64 || !record.updated_at) {
    return false;
  }
  return now - record.cached_at_ms < CUSTOM_EMOJI_CACHE_TTL_MS;
};

async function readCachedRecordsByUuids(uuids: string[]): Promise<Record<string, CachedEmojiRecord>> {
  if (uuids.length === 0 || typeof window === "undefined" || typeof window.indexedDB === "undefined") {
    return {};
  }
  const unique = [...new Set(uuids.map((u) => u.trim()).filter(Boolean))];
  if (unique.length === 0) {
    return {};
  }

  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const out: Record<string, CachedEmojiRecord> = {};
    await Promise.all(
      unique.map(
        (uuid) =>
          new Promise<void>((resolve, reject) => {
            const request = store.get(uuid);
            request.onsuccess = () => {
              const row = request.result as CachedEmojiRecord | undefined;
              if (row?.uuid && row.data_b64 && row.updated_at) {
                out[uuid] = row;
              }
              resolve();
            };
            request.onerror = () => reject(request.error ?? new Error("Failed to read cached emoji."));
          }),
      ),
    );
    return out;
  } catch {
    return {};
  }
}

async function readAllCachedRecords(): Promise<CachedEmojiRecord[]> {
  if (typeof window === "undefined" || typeof window.indexedDB === "undefined") {
    return [];
  }
  try {
    const db = await openDb();
    return await new Promise<CachedEmojiRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => {
        const rows = (request.result as CachedEmojiRecord[]) ?? [];
        resolve(rows.filter((r) => r.uuid && r.data_b64 && r.updated_at));
      };
      request.onerror = () => reject(request.error ?? new Error("Failed to read all cached emojis."));
    });
  } catch {
    return [];
  }
}

async function removeCachedUuids(uuids: string[]): Promise<void> {
  if (uuids.length === 0 || typeof window === "undefined" || typeof window.indexedDB === "undefined") {
    return;
  }
  const unique = [...new Set(uuids.map((u) => u.trim()).filter(Boolean))];
  if (unique.length === 0) {
    return;
  }
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      for (const uuid of unique) {
        store.delete(uuid);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Failed to remove cached emoji."));
    });
  } catch {
    // Best effort.
  }
}

/**
 * Persist emoji rows from the server (or after save). Sets `cached_at_ms` so TTL applies on resolve.
 */
const writeEmojisToCache = async (emojis: Record<string, EmojiItem> | EmojiItem[]): Promise<void> => {
  if (typeof window === "undefined" || typeof window.indexedDB === "undefined") {
    return;
  }
  const list = Array.isArray(emojis) ? emojis : Object.values(emojis);
  const rows = list.filter((item) => item.uuid && item.data_b64 && item.updated_at);
  if (rows.length === 0) {
    return;
  }

  try {
    const db = await openDb();
    const now = Date.now();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      for (const item of rows) {
        store.put({
          ...item,
          cached_at_ms: now,
        } satisfies CachedEmojiRecord);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Failed to write cached emoji."));
    });
  } catch {
    // Best effort; cache is optional.
  }
};

const fetchEmojisResolve = async (uuids: string[]): Promise<EmojisResolveResponse> => {
  const response = await fetch("/api/emojis-resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uuids }),
  });
  if (!response.ok) {
    throw new Error(`emojis-resolve failed (${response.status}).`);
  }
  return (await response.json()) as EmojisResolveResponse;
};

/**
 * Resolve specific emoji UUIDs (messages, reactions). Uses IndexedDB when the row exists and was cached
 * within {@link CUSTOM_EMOJI_CACHE_TTL_MS}; otherwise fetches from `/api/emojis-resolve`.
 */
export const resolveEmojisByUuid = async (uuids: string[]): Promise<Record<string, EmojiItem>> => {
  if (uuids.length === 0) {
    return {};
  }
  const unique = [...new Set(uuids.map((u) => u.trim()).filter(Boolean))];
  if (unique.length === 0) {
    return {};
  }

  const now = Date.now();
  const cachedRows = await readCachedRecordsByUuids(unique);
  const fresh: Record<string, EmojiItem> = {};
  const needNetwork: string[] = [];

  for (const uuid of unique) {
    const row = cachedRows[uuid];
    if (isFreshCache(row, now)) {
      fresh[uuid] = recordToItem(row!);
    } else {
      needNetwork.push(uuid);
    }
  }

  if (needNetwork.length === 0) {
    return fresh;
  }

  const batchKey = needNetwork.slice().sort().join("\0");
  let batchPromise = inFlightResolveBatches.get(batchKey);
  if (!batchPromise) {
    batchPromise = (async () => {
      try {
        const payload = await fetchEmojisResolve(needNetwork);
        const resolved = payload.emojis_by_uuid ?? {};
        await writeEmojisToCache(resolved);
        return resolved;
      } catch {
        return {};
      }
    })().finally(() => {
      inFlightResolveBatches.delete(batchKey);
    });
    inFlightResolveBatches.set(batchKey, batchPromise);
  }

  const fetched = await batchPromise;
  const merged: Record<string, EmojiItem> = { ...fresh, ...fetched };
  for (const uuid of unique) {
    if (!merged[uuid]) {
      const stale = cachedRows[uuid];
      if (stale?.data_b64 && stale.updated_at) {
        merged[uuid] = recordToItem(stale);
      }
    }
  }
  return merged;
};

const fetchEmojisListDelta = async (
  client_known: Array<{ uuid: string; updated_at: string }>,
): Promise<EmojisListResponse> => {
  const response = await fetch("/api/emojis-list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_known }),
  });
  if (!response.ok) {
    throw new Error(`emojis-list failed (${response.status}).`);
  }
  return (await response.json()) as EmojisListResponse;
};

/**
 * Full custom emoji list for picker / editor. Sends cached UUID + `updated_at` so the server returns only
 * new or changed rows (and optional `removed_uuids`). Merges into IndexedDB and returns the sorted list.
 * On network failure, returns cached rows only.
 */
export const loadAllCustomEmojis = async (): Promise<EmojiItem[]> => {
  if (typeof window === "undefined" || typeof window.indexedDB === "undefined") {
    return [];
  }

  const cachedRecords = await readAllCachedRecords();
  const client_known = cachedRecords.map((r) => ({ uuid: r.uuid, updated_at: r.updated_at }));

  const listKey = clientKnownRequestKey(client_known);
  let listPromise = inFlightListByKey.get(listKey);
  if (!listPromise) {
    listPromise = fetchEmojisListDelta(client_known).finally(() => {
      inFlightListByKey.delete(listKey);
    });
    inFlightListByKey.set(listKey, listPromise);
  }

  try {
    const payload = await listPromise;
    await removeCachedUuids(payload.removed_uuids ?? []);
    await writeEmojisToCache(payload.emojis ?? []);
  } catch {
    // Use cache-only below.
  }

  const merged = await readAllCachedRecords();
  const items = merged.map(recordToItem);
  items.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return items;
};

/** After creating or updating an emoji via `/api/emoji-save`, call this so the next resolve/list skips the network. */
export const putEmojiInCache = async (emoji: EmojiItem): Promise<void> => {
  await writeEmojisToCache([emoji]);
};

export const clearAllCachedCustomEmojis = async (): Promise<void> => {
  inFlightResolveBatches.clear();
  inFlightListByKey.clear();

  if (typeof window === "undefined" || typeof window.indexedDB === "undefined") {
    return;
  }

  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Failed to clear custom emoji cache."));
    });
  } catch {
    // Swallow errors so a cache clear request doesn't break user flows.
  }
};
