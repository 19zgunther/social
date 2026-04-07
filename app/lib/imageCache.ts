"use client";

const DB_NAME = "social_image_cache";
const DB_VERSION = 1;
const STORE_NAME = "images";

type CachedImageRecord = {
  image_id: string;
  blob: Blob;
  updated_at: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;
const inFlightByImageId = new Map<string, Promise<Blob>>();

const openDb = (): Promise<IDBDatabase> => {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "image_id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open image cache DB."));
  });

  return dbPromise;
};

const readCachedBlob = async (imageId: string): Promise<Blob | null> => {
  const db = await openDb();
  return new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(imageId);
    request.onsuccess = () => {
      const result = request.result as CachedImageRecord | undefined;
      resolve(result?.blob ?? null);
    };
    request.onerror = () => reject(request.error ?? new Error("Failed to read cached image."));
  });
};

const writeCachedBlob = async (imageId: string, blob: Blob): Promise<void> => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put({
      image_id: imageId,
      blob,
      updated_at: Date.now(),
    } satisfies CachedImageRecord);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to write cached image."));
  });
};

const fetchAndCacheBlob = async (signedUrl: string, imageId: string): Promise<Blob> => {
  const response = await fetch(signedUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch image (${response.status}).`);
  }

  const blob = await response.blob();
  await writeCachedBlob(imageId, blob);
  return blob;
};

const getBlobForImage = async (signedUrl: string, imageId: string): Promise<Blob> => {
  const cachedBlob = await readCachedBlob(imageId);
  if (cachedBlob) {
    return cachedBlob;
  }

  const existingInFlight = inFlightByImageId.get(imageId);
  if (existingInFlight) {
    return existingInFlight;
  }

  const inFlight = fetchAndCacheBlob(signedUrl, imageId).finally(() => {
    inFlightByImageId.delete(imageId);
  });
  inFlightByImageId.set(imageId, inFlight);
  return inFlight;
};

const resolveSignedUrlFromGrant = async (
  imageId: string,
  grant: string,
  opts: { storageUserId?: string | null; threadId?: string | null },
): Promise<string | null> => {
  try {
    const storageUserId = opts.storageUserId?.trim() || "";
    const threadId = opts.threadId?.trim() || "";
    const body: Record<string, string> = {
      image_id: imageId,
      grant,
    };
    if (storageUserId) {
      body.storage_user_id = storageUserId;
    }
    if (threadId) {
      body.thread_id = threadId;
    }
    const response = await fetch("/api/image-resolve", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as { signed_url?: string };
    return data.signed_url ?? null;
  } catch {
    return null;
  }
};

export type ImageCacheOptions = {
  grant?: string | null;
  /** Main-bucket path owner `{userId}/{imageId}`. */
  storageUserId?: string | null;
  /** Thread-bucket path `thread/{threadId}/{imageId}` (use with thread-scoped grants). */
  threadId?: string | null;
};

const __imageURLCache = new Map<string, string>();
export const imageCache = async ({
  signedUrl,
  imageId,
  grant,
  storageUserId,
  threadId,
}: {
  signedUrl: string | null,
  imageId: string | null,
  grant?: string | null;
  storageUserId?: string | null;
  threadId?: string | null;
}): Promise<string | null> => {
  try {
    // If we don't have an image id, return the signed url
    if (!imageId) { return signedUrl; }

    // If the image is already cached, return the cached url
    const memo = __imageURLCache.get(imageId);
    if (memo) { return memo; }

    // If the image is already cached, return the cached url
    const cachedBlob = await readCachedBlob(imageId);
    if (cachedBlob) {
      const url = URL.createObjectURL(cachedBlob);
      __imageURLCache.set(imageId, url);
      return url;
    }

    // If we have a signed url, use it, otherwise resolve a signed url from the grant
    let urlToFetch = signedUrl;
    if (!urlToFetch && grant && (storageUserId || threadId)) {
      urlToFetch = await resolveSignedUrlFromGrant(imageId, grant, { storageUserId, threadId });
    }
    if (!urlToFetch) { return null; }

    // Fetch the blob and cache it
    const blob = await getBlobForImage(urlToFetch, imageId);
    const url = URL.createObjectURL(blob);
    __imageURLCache.set(imageId, url);
    return url;
  } catch {
    return signedUrl ?? null;
  }
};
export const getImageUrlFromCache = (imageId: string): string | undefined => { return __imageURLCache.get(imageId); }

export const clearAllCachedImages = async (): Promise<void> => {
  for (const url of __imageURLCache.values()) {
    URL.revokeObjectURL(url);
  }
  __imageURLCache.clear();
  inFlightByImageId.clear();

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
      tx.onerror = () => reject(tx.error ?? new Error("Failed to clear image cache."));
    });
  } catch {
    // Swallow errors so a cache clear request doesn't break user flows.
  }
};
