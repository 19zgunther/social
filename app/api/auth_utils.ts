import { randomBytes, createCipheriv, createDecipheriv, createHash, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const TOKEN_ALGO = "aes-256-gcm";
const TOKEN_IV_BYTES = 12;
const TOKEN_TAG_BYTES = 16;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_KEY_BYTES = 64;

type AuthTokenPayload = {
  user_id: string;
  username: string;
  user_email: string | null;
  minted_at: number;
};

type AuthError = {
  code: string;
  message: string;
};

export type AuthCheckResult = {
  user_id: string;
  username: string;
  email: string | null;
  minted_at: number;
  error?: AuthError;
};

const buildErrorResult = (code: string, message: string): AuthCheckResult => ({
  user_id: "",
  username: "",
  email: null,
  minted_at: 0,
  error: { code, message },
});

const getTokenKey = (): Buffer => {
  const tokenEncryptionKey = process.env.TOKEN_ENCRYPTION_KEY;

  if (!tokenEncryptionKey) {
    throw new Error("TOKEN_ENCRYPTION_KEY is not configured.");
  }

  return createHash("sha256").update(tokenEncryptionKey).digest();
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

const parseCookieValue = (cookieHeader: string, key: string): string | undefined => {
  for (const segment of cookieHeader.split(";")) {
    const trimmed = segment.trim();
    const [cookieKey, ...rest] = trimmed.split("=");
    if (cookieKey === key) {
      return rest.join("=");
    }
  }

  return undefined;
};

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(PASSWORD_SALT_BYTES);
  const derivedKey = (await scryptAsync(password, salt, PASSWORD_KEY_BYTES)) as Buffer;

  return `${toBase64Url(salt)}:${toBase64Url(derivedKey)}`;
};

export const verifyPassword = async (password: string, storedHash: string): Promise<boolean> => {
  const [saltBase64Url, hashBase64Url] = storedHash.split(":");

  if (!saltBase64Url || !hashBase64Url) {
    return false;
  }

  const salt = fromBase64Url(saltBase64Url);
  const expectedHash = fromBase64Url(hashBase64Url);
  const derivedKey = (await scryptAsync(password, salt, expectedHash.length)) as Buffer;

  if (derivedKey.length !== expectedHash.length) {
    return false;
  }

  return timingSafeEqual(derivedKey, expectedHash);
};

export const mintUserToken = (payload: Omit<AuthTokenPayload, "minted_at">): string => {
  const iv = randomBytes(TOKEN_IV_BYTES);
  const key = getTokenKey();
  const mintedPayload: AuthTokenPayload = {
    ...payload,
    minted_at: Date.now(),
  };
  const cipher = createCipheriv(TOKEN_ALGO, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(mintedPayload), "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${toBase64Url(iv)}.${toBase64Url(authTag)}.${toBase64Url(encrypted)}`;
};

export const decryptUserToken = (token: string): AuthTokenPayload => {
  const [ivEncoded, authTagEncoded, encryptedEncoded] = token.split(".");

  if (!ivEncoded || !authTagEncoded || !encryptedEncoded) {
    throw new Error("Malformed token.");
  }

  const iv = fromBase64Url(ivEncoded);
  const authTag = fromBase64Url(authTagEncoded);
  const encrypted = fromBase64Url(encryptedEncoded);

  if (iv.length !== TOKEN_IV_BYTES || authTag.length !== TOKEN_TAG_BYTES) {
    throw new Error("Invalid token encoding.");
  }

  const key = getTokenKey();
  const decipher = createDecipheriv(TOKEN_ALGO, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(decrypted) as Partial<AuthTokenPayload>;

  if (
    typeof parsed.user_id !== "string" ||
    typeof parsed.username !== "string" ||
    (typeof parsed.user_email !== "string" && parsed.user_email !== null) ||
    typeof parsed.minted_at !== "number"
  ) {
    throw new Error("Invalid token payload.");
  }

  if (parsed.minted_at <= 0 || parsed.minted_at > Date.now() + 5 * 60_000) {
    throw new Error("Invalid token timestamp.");
  }

  return {
    user_id: parsed.user_id,
    username: parsed.username,
    user_email: parsed.user_email,
    minted_at: parsed.minted_at,
  };
};

export const extractAuthToken = (request: Request): string | undefined => {
  const authorizationHeader = request.headers.get("authorization");
  if (authorizationHeader?.startsWith("Bearer ")) {
    return authorizationHeader.slice("Bearer ".length).trim();
  }

  const cookieHeader = request.headers.get("cookie");
  if (cookieHeader) {
    return parseCookieValue(cookieHeader, "auth_token");
  }

  return undefined;
};

export const authCheck = (request: Request): AuthCheckResult => {
  const token = extractAuthToken(request);

  if (!token) {
    return buildErrorResult("missing_token", "No auth token provided.");
  }

  try {
    const payload = decryptUserToken(token);
    return {
      user_id: payload.user_id,
      username: payload.username,
      email: payload.user_email,
      minted_at: payload.minted_at,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Token validation failed.";
    return buildErrorResult("invalid_token", message);
  }
};