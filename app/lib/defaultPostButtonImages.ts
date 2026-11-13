import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { isSafeDefaultEventImageKey } from "@/app/lib/defaultEventImagesShared";

const DEFAULT_POST_BUTTON_IMAGES_DIR = path.join(process.cwd(), "app/defaultPostButtonImages");

function pngPathForKey(key: string): string {
  return path.join(DEFAULT_POST_BUTTON_IMAGES_DIR, `${key}.png`);
}

export async function isDefaultPostButtonImageKey(key: string): Promise<boolean> {
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

export async function readDefaultPostButtonImageFile(
  key: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  if (!(await isDefaultPostButtonImageKey(key))) {
    return null;
  }
  const buffer = await readFile(pngPathForKey(key));
  return { buffer, mimeType: "image/png" };
}
