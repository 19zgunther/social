"use client";

import type { AnimationClip } from "./types";
import {
  getActiveLoadingClip,
  setMeta,
  getMeta,
} from "./db";

export const CLIP_UPDATED_EVENT = "animator-clip-updated";

export function notifyClipUpdated(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(CLIP_UPDATED_EVENT));
}

export async function resolveActiveClip(): Promise<AnimationClip> {
  return getActiveLoadingClip();
}

export async function setActiveLoadingAnimation(id: string): Promise<void> {
  const meta = await getMeta();
  await setMeta({
    ...meta,
    activeLoadingId: id,
  });
  notifyClipUpdated();
}
