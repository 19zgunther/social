"use client";

const DB_NAME = "social_thread_reply_collapse";
const DB_VERSION = 1;
const STORE_NAME = "collapsed";

type CollapsedRecord = {
  message_id: string;
  updated_at: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

const openDb = (): Promise<IDBDatabase> => {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "message_id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open thread reply collapse DB."));
  });

  return dbPromise;
};

/** Returns message ids that are marked collapsed in IndexedDB (subset of `messageIds`). */
export async function readThreadReplyCollapsedSet(messageIds: string[]): Promise<Set<string>> {
  if (messageIds.length === 0 || typeof window === "undefined" || typeof window.indexedDB === "undefined") {
    return new Set();
  }

  const unique = [...new Set(messageIds.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) {
    return new Set();
  }

  try {
    const db = await openDb();
    return new Promise<Set<string>>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const out = new Set<string>();
      let pending = unique.length;
      for (const id of unique) {
        const request = store.get(id);
        request.onsuccess = () => {
          if (request.result) {
            out.add(id);
          }
          pending -= 1;
          if (pending === 0) {
            resolve(out);
          }
        };
        request.onerror = () => reject(request.error ?? new Error("Failed to read thread reply collapse."));
      }
    });
  } catch {
    return new Set();
  }
}

export async function writeThreadReplyCollapsed(messageId: string): Promise<void> {
  if (!messageId.trim() || typeof window === "undefined" || typeof window.indexedDB === "undefined") {
    return;
  }

  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put({
        message_id: messageId,
        updated_at: Date.now(),
      } satisfies CollapsedRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Failed to write thread reply collapse."));
    });
  } catch {
    // Best effort only.
  }
}

export async function deleteThreadReplyCollapsed(messageId: string): Promise<void> {
  if (!messageId.trim() || typeof window === "undefined" || typeof window.indexedDB === "undefined") {
    return;
  }

  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.delete(messageId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Failed to delete thread reply collapse."));
    });
  } catch {
    // Best effort only.
  }
}
