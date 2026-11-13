"use client";

import { useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import CachedImage from "@/app/components/utils/CachedImage";
import { UserSessionSyncContext } from "@/app/components/UserSessionSyncContext";
import {
  ensureUserProfileImages,
  getUserProfileImageCacheEntry,
  primeUserProfileImageCache,
  subscribeUserProfileImageCache,
} from "@/app/lib/userProfileImageCache";

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;

/** Green ring fill: last 30s full; after that, fraction = 1 − (age / 1h) until it hits zero. */
export function presenceRingFraction(lastMs: number | null, nowMs: number) {
  const dt = nowMs - (lastMs ?? 0);
  if (dt > ONE_WEEK_MS) {
    return {
      ringFrac: 1,
      color: "var(--muted)",
    };
  }
  if (dt > ONE_DAY_MS) {
    return {
      ringFrac: 1 - dt / ONE_WEEK_MS,
      color: "var(--warning)",
      underColor: "var(--muted)",
    };
  }
  if (dt > ONE_HOUR_MS) {
    return {
      ringFrac: 1 - dt / ONE_DAY_MS,
      color: "var(--warning)",
      underColor: "var(--warning)",
    };
  }
  if (dt > ONE_MINUTE_MS) {
    return {
      ringFrac: 1 - dt / ONE_HOUR_MS,
      color: "var(--success)",
      underColor: "var(--warning)",
    };
  }
  return {
    ringFrac: 1,
    color: "var(--success)",
  };
}

const AVATAR_PALETTES = [
  { from: "#70aad6", to: "#897aaf", ink: "#0b1020" },
  { from: "#c084e8", to: "#764fad", ink: "#f5f0ff" },
  { from: "#55b777", to: "#70aad6", ink: "#07140f" },
  { from: "#f59e0b", to: "#bb8a9c", ink: "#1a0f08" },
  { from: "#22c55e", to: "#897aaf", ink: "#06140c" },
  { from: "#bb8a9c", to: "#c084e8", ink: "#1a0a14" },
  { from: "#764fad", to: "#70aad6", ink: "#f4f7ff" },
  { from: "#e879a9", to: "#f59e0b", ink: "#1a0a10" },
  { from: "#38bdf8", to: "#55b777", ink: "#061018" },
  { from: "#a78bfa", to: "#f472b6", ink: "#12081c" },
] as const;

const AVATAR_FONTS = [
  '"Redaction 50", serif',
  'var(--font-avatar-playwrite), "Playwrite FR Trad", cursive',
  'var(--font-avatar-six-caps), "Six Caps", sans-serif',
  'var(--font-avatar-black-ops), "Black Ops One", system-ui',
  'var(--font-avatar-bitcount), "Bitcount Grid Single", monospace',
  'var(--font-avatar-italianno), Italianno, cursive',
  'var(--font-avatar-kelly-slab), "Kelly Slab", serif',
] as const;

function hashUsername(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function avatarInitials(username: string): string {
  const cleaned = username.trim().replace(/^@/, "");
  if (!cleaned) return "?";
  const parts = cleaned.split(/[_\-.]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  if (cleaned.length === 1) return cleaned.toUpperCase();
  // Prefer first + second letter for short names; first + last for longer ones.
  if (cleaned.length <= 3) return cleaned.slice(0, 2).toUpperCase();
  return `${cleaned[0]}${cleaned[cleaned.length - 1]}`.toUpperCase();
}

export function usernameAvatarStyle(username: string) {
  const seed = username.trim() || "?";
  const h = hashUsername(seed.toLowerCase());
  const palette = AVATAR_PALETTES[h % AVATAR_PALETTES.length]!;
  const fontFamily = AVATAR_FONTS[(h >>> 8) % AVATAR_FONTS.length]!;
  const angle = 25 + ((h >>> 16) % 140);
  return {
    initials: avatarInitials(seed),
    background: `linear-gradient(${angle}deg, ${palette.from}, ${palette.to})`,
    color: palette.ink,
    fontFamily,
  };
}

type UserProfileImageProps = {
  userId: string;
  sizePx: number;
  alt: string;
  username?: string | null;
  signedUrl?: string | null;
  imageId?: string | null;
  imageAccessGrant?: string | null;
  /** Defaults to `userId` when resolving main-bucket profile images. */
  imageStorageUserId?: string | null;
  className?: string;
  onClick?: () => void;
};

export default function UserProfileImage({
  userId,
  sizePx,
  alt,
  username,
  signedUrl,
  imageId,
  imageAccessGrant,
  imageStorageUserId,
  className,
  onClick,
}: UserProfileImageProps) {
  const sessionCtx = useContext(UserSessionSyncContext);
  const nowMs = sessionCtx?.nowMs ?? Date.now();
  const lastMs = sessionCtx?.lastActiveByUserId[userId] ?? null;
  const { ringFrac, color, underColor } = useMemo(
    () => presenceRingFraction(lastMs, nowMs),
    [lastMs, nowMs],
  );
  const showRing = ringFrac > 0;

  const hasExplicitGrant = Boolean(imageId && imageAccessGrant);

  const cachedEntry = useSyncExternalStore(
    subscribeUserProfileImageCache,
    () => getUserProfileImageCacheEntry(userId),
    () => undefined,
  );

  useEffect(() => {
    if (hasExplicitGrant) {
      primeUserProfileImageCache(userId, {
        profile_image_id: imageId ?? null,
        profile_image_access_grant: imageAccessGrant ?? null,
      });
      return;
    }
    if (!signedUrl) {
      ensureUserProfileImages([userId]);
    }
  }, [userId, hasExplicitGrant, imageId, imageAccessGrant, signedUrl]);

  const vb = 100;
  const stroke = 5;
  const r = vb / 2 - stroke / 2;
  const circumference = 2 * Math.PI * r;
  const dashLen = ringFrac * circumference;

  const resolvedImageId = hasExplicitGrant
    ? (imageId ?? null)
    : (cachedEntry?.profile_image_id ?? null);
  const resolvedGrant = hasExplicitGrant
    ? (imageAccessGrant ?? null)
    : (cachedEntry?.profile_image_access_grant ?? null);
  const storageForGrant = imageStorageUserId ?? userId;
  const showPhoto = Boolean(
    signedUrl || (resolvedGrant && resolvedImageId && storageForGrant),
  );

  const avatarSeed = username?.trim() || userId;
  const avatar = useMemo(() => usernameAvatarStyle(avatarSeed), [avatarSeed]);
  const letterSize = Math.max(10, Math.round(sizePx * (avatar.initials.length > 1 ? 0.34 : 0.42)));

  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-full bg-surface ${showRing ? "" : "border border-border"} ${className ?? ""}`}
      style={{ width: sizePx, height: sizePx }}
      onClick={onClick}
    >
      {showPhoto ? (
        <CachedImage
          {...(signedUrl ? { signedUrl } : {})}
          imageId={resolvedImageId}
          imageAccessGrant={resolvedGrant}
          imageStorageUserId={resolvedGrant ? storageForGrant : null}
          alt={alt}
          className="h-full w-full rounded-full object-cover"
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center select-none"
          style={{ background: avatar.background }}
          aria-hidden
        >
          <span
            style={{
              color: avatar.color,
              fontFamily: avatar.fontFamily,
              fontSize: letterSize,
              fontWeight: 700,
              letterSpacing: avatar.initials.length > 1 ? "-0.04em" : 0,
              lineHeight: 1,
              textShadow: "0 1px 0 rgba(255,255,255,0.18)",
            }}
          >
            {avatar.initials}
          </span>
        </div>
      )}

      {showRing ? (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`0 0 ${vb} ${vb}`}
          aria-hidden
        >
          <circle
            cx={vb / 2}
            cy={vb / 2}
            r={r}
            fill="none"
            stroke={underColor}
            strokeWidth={stroke}
            strokeLinecap="round"
            transform={`rotate(-90 ${vb / 2} ${vb / 2})`}
          />
          <circle
            cx={vb / 2}
            cy={vb / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dashLen} ${circumference}`}
            transform={`rotate(-90 ${vb / 2} ${vb / 2})`}
          />
        </svg>
      ) : null}
    </div>
  );
}
