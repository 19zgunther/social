"use client";

import { useContext, useMemo } from "react";
import { CircleUserRound } from "lucide-react";
import CachedImage from "@/app/components/utils/CachedImage";
import { UserSessionSyncContext } from "@/app/components/UserSessionSyncContext";

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
       color: 'gray'
    }
  }
  if (dt > ONE_DAY_MS) {
    return {
      ringFrac: 1 - dt / ONE_WEEK_MS,
      color: 'orange',
      underColor: 'gray',
    }
  }
  if (dt > ONE_HOUR_MS) {
    return {
      ringFrac: 1 - dt / ONE_DAY_MS,
      color: '#f2c22e',
      underColor: 'orange',
    }
  }
  if (dt > ONE_MINUTE_MS) {
    return {
      ringFrac: 1 - dt / ONE_HOUR_MS,
      color: '#22c55e',
      underColor: '#f2c22e',
    }
  }
  return {
    ringFrac: 1,
    color: '#22c55e'
  }
}

type UserProfileImageProps = {
  userId: string;
  sizePx: number;
  alt: string;
  signedUrl?: string | null;
  imageId?: string | null;
  className?: string;
};

export default function UserProfileImage({
  userId,
  sizePx,
  alt,
  signedUrl,
  imageId,
  className,
}: UserProfileImageProps) {
  const sessionCtx = useContext(UserSessionSyncContext);
  const nowMs = sessionCtx?.nowMs ?? Date.now();
  const lastMs = sessionCtx?.lastActiveByUserId[userId] ?? null;
  const { ringFrac, color, underColor } = useMemo(() => presenceRingFraction(lastMs, nowMs), [lastMs, nowMs]);
  const showRing = ringFrac > 0;

  const vb = 100;
  const stroke = 5;
  const r = vb / 2 - stroke / 2;
  const circumference = 2 * Math.PI * r;
  const dashLen = ringFrac * circumference;

  return (
    <div
      className={`relative shrink-0 rounded-full bg-secondary-background ${showRing ? "" : "border border-accent-1"} ${className ?? ""}`}
      style={{ width: sizePx, height: sizePx }}
    >
      {signedUrl ? (
        <CachedImage
          signedUrl={signedUrl}
          imageId={imageId ?? null}
          alt={alt}
          className="h-full w-full rounded-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center rounded-full">
          <CircleUserRound
            className="text-accent-2"
            style={{
              width: Math.round(sizePx * 0.55),
              height: Math.round(sizePx * 0.55),
            }}
            aria-hidden
          />
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
