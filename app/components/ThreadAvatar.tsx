"use client";

import { useEffect, useSyncExternalStore, type CSSProperties } from "react";
import { ImageIcon, UserPlaceholderIcon } from "@/app/components/Icons";
import CachedImage from "@/app/components/utils/CachedImage";
import {
  ensureUserProfileImages,
  getUserProfileImageCacheEntry,
  subscribeUserProfileImageCache,
} from "@/app/lib/userProfileImageCache";

const MAX_COLLAGE_FACES = 4;

type ThreadAvatarProps = {
  sizePx: number;
  threadId: string;
  imageId?: string | null;
  imageUrl?: string | null;
  imageAccessGrant?: string | null;
  memberUserIds?: string[] | null;
  /** Omit this user from the collage (typically the viewer). */
  currentUserId?: string | null;
  alt?: string;
  className?: string;
};

/** Absolute positions as % of the container, plus face diameter as a fraction of sizePx. */
type FaceLayout = {
  faceFrac: number;
  slots: { left: number; top: number }[];
};

function collageLayout(faceCount: number): FaceLayout {
  if (faceCount <= 1) {
    return { faceFrac: 1, slots: [{ left: 0, top: 0 }] };
  }
  if (faceCount === 2) {
    return {
      faceFrac: 0.68,
      slots: [
        { left: 0, top: 2 },
        { left: 32, top: 30 },
      ],
    };
  }
  if (faceCount === 3) {
    return {
      faceFrac: 0.56,
      slots: [
        { left: 22, top: 0 },
        { left: 0, top: 42 },
        { left: 44, top: 42 },
      ],
    };
  }
  return {
    faceFrac: 0.52,
    slots: [
      { left: 0, top: 0 },
      { left: 48, top: 0 },
      { left: 0, top: 48 },
      { left: 48, top: 48 },
    ],
  };
}

function MemberFace({
  userId,
  sizePx,
  className,
  style,
}: {
  userId: string;
  sizePx: number;
  className?: string;
  style?: CSSProperties;
}) {
  const cachedEntry = useSyncExternalStore(
    subscribeUserProfileImageCache,
    () => getUserProfileImageCacheEntry(userId),
    () => undefined,
  );

  const imageId = cachedEntry?.profile_image_id ?? null;
  const imageAccessGrant = cachedEntry?.profile_image_access_grant ?? null;
  const showPhoto = Boolean(imageId && imageAccessGrant);

  return (
    <div
      className={`absolute overflow-hidden rounded-full border border-border bg-surface ${className ?? ""}`}
      style={{ width: sizePx, height: sizePx, ...style }}
    >
      {showPhoto ? (
        <CachedImage
          imageId={imageId}
          imageAccessGrant={imageAccessGrant}
          imageStorageUserId={userId}
          alt=""
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <UserPlaceholderIcon
            className="text-muted"
            style={{ width: Math.round(sizePx * 0.55), height: Math.round(sizePx * 0.55) }}
            aria-hidden
          />
        </div>
      )}
    </div>
  );
}

function MemberCollage({
  memberUserIds,
  sizePx,
}: {
  memberUserIds: string[];
  sizePx: number;
}) {
  const faces = memberUserIds.slice(0, MAX_COLLAGE_FACES);
  const faceKey = faces.join("|");
  const layout = collageLayout(faces.length);
  const faceSizePx = Math.max(12, Math.round(sizePx * layout.faceFrac));

  useEffect(() => {
    if (faces.length === 0) {
      return;
    }
    ensureUserProfileImages(faces);
    // faces is derived from faceKey; re-fetch only when the id set changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faceKey]);

  return (
    <div className="relative h-full w-full">
      {faces.map((userId, index) => {
        const slot = layout.slots[index] ?? layout.slots[0];
        return (
          <MemberFace
            key={userId}
            userId={userId}
            sizePx={faceSizePx}
            style={{
              left: `${slot.left}%`,
              top: `${slot.top}%`,
              zIndex: index + 1,
            }}
          />
        );
      })}
    </div>
  );
}

export default function ThreadAvatar({
  sizePx,
  threadId,
  imageId,
  imageUrl,
  imageAccessGrant,
  memberUserIds,
  currentUserId,
  alt = "Chat photo",
  className,
}: ThreadAvatarProps) {
  const hasThreadImage = Boolean(imageId && (imageUrl || imageAccessGrant));
  const members = [
    ...new Set(
      (memberUserIds ?? []).filter(
        (userId) => Boolean(userId) && userId !== currentUserId,
      ),
    ),
  ];
  const showCollage = !hasThreadImage && members.length > 0;

  return (
    <div
      className={`relative shrink-0 ${
        showCollage
          ? ""
          : "overflow-hidden rounded-full border border-border bg-border/20"
      } ${className ?? ""}`}
      style={{ width: sizePx, height: sizePx }}
      aria-label={alt}
    >
      {hasThreadImage ? (
        <CachedImage
          signedUrl={imageUrl ?? null}
          imageAccessGrant={imageAccessGrant ?? null}
          imageThreadId={threadId}
          imageId={imageId ?? null}
          alt={alt}
          className="h-full w-full object-cover"
        />
      ) : showCollage ? (
        <MemberCollage memberUserIds={members} sizePx={sizePx} />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <ImageIcon
            className="text-muted"
            style={{ width: Math.round(sizePx * 0.5), height: Math.round(sizePx * 0.5) }}
            aria-hidden
          />
        </div>
      )}
    </div>
  );
}
