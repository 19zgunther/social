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

const __imageURLCache = new Map<string, string>();
export const imageCache = async (signedUrl: string | null, imageId: string | null): Promise<string | null> => {
  if (!signedUrl) {
    return null;
  }

  if (!imageId || typeof window === "undefined" || typeof window.indexedDB === "undefined") {
    return signedUrl;
  }

  try {
    const blob = await getBlobForImage(signedUrl, imageId);
    const url = URL.createObjectURL(blob);
    __imageURLCache.set(imageId, url);
    return url;
  } catch {
    return signedUrl;
  }
};
export const getImageUrlFromCache = (imageId: string): string | undefined => {  return __imageURLCache.get(imageId); }
