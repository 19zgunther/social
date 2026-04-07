import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export const DEFAULT_IMAGE_ACCESS_GRANT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type MainBucketGrantPayloadV1 = {
  v: 1;
  /** Image object id (UUID). */
  i: string;
  /** Storage path owner: `users` bucket prefix `{o}/{i}`. */
  o: string;
  /** Viewer user id the grant was minted for (must match session on resolve). */
  w: string;
  /** Expiry time (Unix ms). */
  e: number;
};

/** Thread-scoped object under `thread/{threadId}/{imageId}`. */
type ThreadBucketGrantPayloadV2 = {
  v: 2;
  i: string;
  t: string;
  w: string;
  e: number;
};

const getGrantKey = (): Buffer => {
  const raw = process.env.IMAGE_ACCESS_GRANT_KEY ?? process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("IMAGE_ACCESS_GRANT_KEY (or TOKEN_ENCRYPTION_KEY) is not configured.");
  }
  return createHash("sha256").update(raw).digest();
};

const toBase64Url = (value: Buffer): string =>
  value
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

const fromBase64Url = (value: string): Buffer => {
  const base64Value = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = `${base64Value}${"=".repeat((4 - (base64Value.length % 4)) % 4)}`;
  return Buffer.from(padded, "base64");
};

export const createMainBucketImageAccessGrant = (input: {
  imageId: string;
  storageUserId: string;
  viewerUserId: string;
  ttlMs?: number;
}): string => {
  const ttl = input.ttlMs ?? DEFAULT_IMAGE_ACCESS_GRANT_TTL_MS;
  const payload: MainBucketGrantPayloadV1 = {
    v: 1,
    i: input.imageId,
    o: input.storageUserId,
    w: input.viewerUserId,
    e: Date.now() + ttl,
  };
  const plaintext = JSON.stringify(payload);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, getGrantKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return toBase64Url(Buffer.concat([iv, ciphertext, tag]));
};

const decryptGrantJson = (token: string): unknown | null => {
  try {
    const buf = fromBase64Url(token);
    if (buf.length < IV_LENGTH + TAG_LENGTH + 1) {
      return null;
    }
    const iv = buf.subarray(0, IV_LENGTH);
    const tag = buf.subarray(buf.length - TAG_LENGTH);
    const ciphertext = buf.subarray(IV_LENGTH, buf.length - TAG_LENGTH);
    const decipher = createDecipheriv(ALGO, getGrantKey(), iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    return JSON.parse(plain) as unknown;
  } catch {
    return null;
  }
};

export const verifyMainBucketImageAccessGrant = (token: string): MainBucketGrantPayloadV1 | null => {
  const raw = decryptGrantJson(token);
  if (!raw || typeof raw !== "object" || raw === null || !("v" in raw)) {
    return null;
  }
  const data = raw as MainBucketGrantPayloadV1;
  if (
    data.v !== 1
    || typeof data.i !== "string"
    || typeof data.o !== "string"
    || typeof data.w !== "string"
    || typeof data.e !== "number"
  ) {
    return null;
  }
  return data;
};

export const createThreadBucketImageAccessGrant = (input: {
  imageId: string;
  threadId: string;
  viewerUserId: string;
  ttlMs?: number;
}): string => {
  const ttl = input.ttlMs ?? DEFAULT_IMAGE_ACCESS_GRANT_TTL_MS;
  const payload: ThreadBucketGrantPayloadV2 = {
    v: 2,
    i: input.imageId,
    t: input.threadId,
    w: input.viewerUserId,
    e: Date.now() + ttl,
  };
  const plaintext = JSON.stringify(payload);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, getGrantKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return toBase64Url(Buffer.concat([iv, ciphertext, tag]));
};

export const verifyThreadBucketImageAccessGrant = (token: string): ThreadBucketGrantPayloadV2 | null => {
  const raw = decryptGrantJson(token);
  if (!raw || typeof raw !== "object" || raw === null || !("v" in raw)) {
    return null;
  }
  const data = raw as ThreadBucketGrantPayloadV2;
  if (
    data.v !== 2
    || typeof data.i !== "string"
    || typeof data.t !== "string"
    || typeof data.w !== "string"
    || typeof data.e !== "number"
  ) {
    return null;
  }
  return data;
};
