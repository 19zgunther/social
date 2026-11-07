import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  defaultEventImageLabel,
  isSafeDefaultEventImageKey,
} from "@/app/lib/defaultEventImagesShared";

export { defaultEventImageLabel, isSafeDefaultEventImageKey } from "@/app/lib/defaultEventImagesShared";

const DEFAULT_EVENT_IMAGES_DIR = path.join(process.cwd(), "app/defaultEventImages");

function pngPathForKey(key: string): string {
  return path.join(DEFAULT_EVENT_IMAGES_DIR, `${key}.png`);
}

/** All `.png` basenames in `app/defaultEventImages` (no extension). */
export async function listDefaultEventImageKeys(): Promise<string[]> {
  const entries = await readdir(DEFAULT_EVENT_IMAGES_DIR);
  return entries
    .filter((name) => name.toLowerCase().endsWith(".png"))
    .map((name) => name.slice(0, -".png".length))
    .filter((key) => isSafeDefaultEventImageKey(key))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export async function isDefaultEventImageKey(key: string): Promise<boolean> {
  if (!isSafeDefaultEventImageKey(key)) {
    return false;
  }
  try {
    await access(pngPathForKey(key));
    return true;
  } catch {
    return false;
  }
}

/** Load a bundled default event background as base64 for upload into thread storage. */
export async function readDefaultEventImage(
  key: string,
): Promise<{ base64Data: string; mimeType: string }> {
  if (!(await isDefaultEventImageKey(key))) {
    throw new Error("invalid_default_background");
  }
  const buffer = await readFile(pngPathForKey(key));
  return { base64Data: buffer.toString("base64"), mimeType: "image/png" };
}

export async function readDefaultEventImageFile(
  key: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  if (!(await isDefaultEventImageKey(key))) {
    return null;
  }
  const buffer = await readFile(pngPathForKey(key));
  return { buffer, mimeType: "image/png" };
}
