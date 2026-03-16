/* eslint-disable no-restricted-globals */
"use client";

const DB_NAME = "social_app_cache";
const DB_VERSION = 1;
const STORE_NAME = "kv";

type CacheRecord = {
  key: string;
  value: unknown;
  updated_at: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

const isIndexedDbAvailable = (): boolean => {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
};

const openDb = (): Promise<IDBDatabase> => {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open cache DB."));
  });

  return dbPromise;
};

const readFromIndexedDb = async <T>(key: string): Promise<T | null> => {
  const db = await openDb();
  return new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => {
      const result = request.result as CacheRecord | undefined;
      resolve((result?.value as T | undefined) ?? null);
    };
    request.onerror = () => reject(request.error ?? new Error("Failed to read cached value."));
  });
};

const writeToIndexedDb = async (key: string, value: unknown): Promise<void> => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put({
      key,
      value,
      updated_at: Date.now(),
    } satisfies CacheRecord);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to write cached value."));
  });
};

const LOCAL_STORAGE_PREFIX = "social_app_cache_";

const readFromLocalStorage = <T>(key: string): T | null => {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_PREFIX + key);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const writeToLocalStorage = (key: string, value: unknown): void => {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.setItem(
      LOCAL_STORAGE_PREFIX + key,
      JSON.stringify({
        value,
        updated_at: Date.now(),
      }),
    );
  } catch {
    // Best effort only.
  }
};

export const readCacheValue = async <T>(key: string): Promise<T | null> => {
  if (!key) {
    return null;
  }

  if (!isIndexedDbAvailable()) {
    const stored = readFromLocalStorage<{ value: T } | T>(key);
    if (!stored) {
      return null;
    }
    if (typeof stored === "object" && stored !== null && "value" in stored) {
      return (stored as { value: T }).value;
    }
    return stored as T;
  }

  try {
    return await readFromIndexedDb<T>(key);
  } catch {
    return null;
  }
};

export const writeCacheValue = async (key: string, value: unknown): Promise<void> => {
  if (!key) {
    return;
  }

  if (!isIndexedDbAvailable()) {
    writeToLocalStorage(key, value);
    return;
  }

  try {
    await writeToIndexedDb(key, value);
  } catch {
    // Best effort only.
  }
};

