/** Safe default-image key: letters, numbers, underscore, hyphen. */
const DEFAULT_EVENT_IMAGE_KEY_RE = /^[a-z0-9][a-z0-9_-]*$/i;

export function isSafeDefaultEventImageKey(value: string): boolean {
  return DEFAULT_EVENT_IMAGE_KEY_RE.test(value);
}

export function defaultEventImageLabel(key: string): string {
  const base = key.replace(/_\d+$/, "").replaceAll("_", " ");
  return base.replace(/\b\w/g, (char) => char.toUpperCase());
}
