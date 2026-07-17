"use client";

import type {
  AnimationClip,
  AnimationDocument,
  AnimationSummary,
  AnimatorMeta,
} from "./types";
import { DEFAULT_CLIP } from "./defaultClip";
import { cloneClip, validateClip } from "./validate";

const DB_NAME = "social_animator";
const DB_VERSION = 1;
const ANIMATIONS_STORE = "animations";
const META_STORE = "meta";
const META_KEY = "meta";

const DEFAULT_META: AnimatorMeta = {
  version: 1,
  openDocumentId: null,
  activeLoadingId: null,
};

let dbPromise: Promise<IDBDatabase> | null = null;

function isIndexedDbAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  if (!isIndexedDbAvailable()) {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ANIMATIONS_STORE)) {
        const store = db.createObjectStore(ANIMATIONS_STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open animator DB"));
  });

  return dbPromise;
}

function newDocumentId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `anim-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createAnimationDocument(
  name: string,
  clip: AnimationClip,
  id?: string,
): AnimationDocument {
  const now = Date.now();
  return {
    id: id ?? newDocumentId(),
    name,
    createdAt: now,
    updatedAt: now,
    clip: cloneClip(clip),
  };
}

export async function listAnimations(): Promise<AnimationSummary[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ANIMATIONS_STORE, "readonly");
    const store = tx.objectStore(ANIMATIONS_STORE);
    const request = store.getAll();
    request.onsuccess = () => {
      const docs = (request.result as AnimationDocument[]) ?? [];
      const summaries = docs
        .map((doc) => ({
          id: doc.id,
          name: doc.name,
          updatedAt: doc.updatedAt,
          createdAt: doc.createdAt,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(summaries);
    };
    request.onerror = () => reject(request.error ?? new Error("Failed to list animations"));
  });
}

export async function getAnimation(id: string): Promise<AnimationDocument | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ANIMATIONS_STORE, "readonly");
    const store = tx.objectStore(ANIMATIONS_STORE);
    const request = store.get(id);
    request.onsuccess = () => {
      const doc = request.result as AnimationDocument | undefined;
      if (!doc) {
        resolve(null);
        return;
      }
      const validated = validateClip(doc.clip);
      if (!validated.ok) {
        resolve(null);
        return;
      }
      resolve({ ...doc, clip: validated.clip });
    };
    request.onerror = () => reject(request.error ?? new Error("Failed to get animation"));
  });
}

export async function putAnimation(doc: AnimationDocument): Promise<void> {
  const validated = validateClip(doc.clip);
  if (!validated.ok) {
    throw new Error(validated.error);
  }
  const toStore: AnimationDocument = {
    ...doc,
    clip: validated.clip,
    updatedAt: Date.now(),
  };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ANIMATIONS_STORE, "readwrite");
    tx.objectStore(ANIMATIONS_STORE).put(toStore);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to save animation"));
  });
}

export async function deleteAnimation(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ANIMATIONS_STORE, "readwrite");
    tx.objectStore(ANIMATIONS_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to delete animation"));
  });
}

type MetaRow = { key: string } & AnimatorMeta;

export async function getMeta(): Promise<AnimatorMeta> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, "readonly");
    const request = tx.objectStore(META_STORE).get(META_KEY);
    request.onsuccess = () => {
      const row = request.result as MetaRow | undefined;
      if (!row) {
        resolve({ ...DEFAULT_META });
        return;
      }
      resolve({
        version: 1,
        openDocumentId: row.openDocumentId ?? null,
        activeLoadingId: row.activeLoadingId ?? null,
      });
    };
    request.onerror = () => reject(request.error ?? new Error("Failed to read meta"));
  });
}

export async function setMeta(meta: AnimatorMeta): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(META_STORE, "readwrite");
    const row: MetaRow = { key: META_KEY, ...meta, version: 1 };
    tx.objectStore(META_STORE).put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to write meta"));
  });
}

export async function getActiveLoadingClip(): Promise<AnimationClip> {
  try {
    const meta = await getMeta();
    if (meta.activeLoadingId) {
      const doc = await getAnimation(meta.activeLoadingId);
      if (doc) {
        return cloneClip(doc.clip);
      }
    }
  } catch {
    // fall through
  }
  return cloneClip(DEFAULT_CLIP);
}

export async function countAnimations(): Promise<number> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ANIMATIONS_STORE, "readonly");
    const request = tx.objectStore(ANIMATIONS_STORE).count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to count animations"));
  });
}

/** Seed default doc and/or migrate legacy localStorage clip. Idempotent. */
export async function ensureSeeded(): Promise<AnimationDocument> {
  const count = await countAnimations();
  let meta = await getMeta();

  if (count === 0) {
    const legacy = readLegacyLocalStorageClip();
    const doc = createAnimationDocument(
      legacy ? "Migrated loading" : "Loading run",
      legacy ?? DEFAULT_CLIP,
    );
    await putAnimation(doc);
    meta = {
      version: 1,
      openDocumentId: doc.id,
      activeLoadingId: doc.id,
    };
    await setMeta(meta);
    clearLegacyLocalStorageClip();
    return doc;
  }

  if (meta.openDocumentId) {
    const open = await getAnimation(meta.openDocumentId);
    if (open) {
      return open;
    }
  }

  const list = await listAnimations();
  const first = list[0];
  if (!first) {
    const doc = createAnimationDocument("Loading run", DEFAULT_CLIP);
    await putAnimation(doc);
    await setMeta({
      version: 1,
      openDocumentId: doc.id,
      activeLoadingId: doc.id,
    });
    return doc;
  }

  const doc = await getAnimation(first.id);
  if (!doc) {
    throw new Error("Failed to load animation");
  }

  const nextMeta: AnimatorMeta = {
    version: 1,
    openDocumentId: doc.id,
    activeLoadingId: meta.activeLoadingId ?? doc.id,
  };
  await setMeta(nextMeta);
  return doc;
}

const LEGACY_STORAGE_KEY = "social.animator.loadingClip.v1";

function readLegacyLocalStorageClip(): AnimationClip | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const result = validateClip(JSON.parse(raw) as unknown);
    return result.ok ? result.clip : null;
  } catch {
    return null;
  }
}

function clearLegacyLocalStorageClip(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(LEGACY_STORAGE_KEY);
}
