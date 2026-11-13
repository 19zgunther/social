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

/** Absolute positions as % of the container; faceFrac is diameter as a fraction of sizePx. */
type FaceSlot = {
  left: number;
  top: number;
  faceFrac: number;
};

function collageSlots(faceCount: number): FaceSlot[] {
  if (faceCount <= 1) {
    return [{ left: 0, top: 0, faceFrac: 1 }];
  }
  if (faceCount === 2) {
    return [
      { left: 0, top: 2, faceFrac: 0.68 },
      { left: 32, top: 30, faceFrac: 0.68 },
    ];
  }
  if (faceCount === 3) {
    return [
      { left: 20, top: 0, faceFrac: 0.58 },
      { left: 0, top: 40, faceFrac: 0.52 },
      { left: 46, top: 42, faceFrac: 0.5 },
    ];
  }
  // Organic cluster: one large anchor + smaller faces overlapping off-grid.
  return [
    { left: -2, top: 16, faceFrac: 0.66 },
    { left: 40, top: -4, faceFrac: 0.5 },
    { left: 52, top: 38, faceFrac: 0.44 },
    { left: 18, top: 52, faceFrac: 0.38 },
  ];
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
  const slots = collageSlots(faces.length);

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
        const slot = slots[index] ?? slots[0];
        const faceSizePx = Math.max(12, Math.round(sizePx * slot.faceFrac));
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
  // Prefer other members for the collage; if you're the only member (e.g. solo
  // event threads), fall back to your own profile photo instead of the empty icon.
  const allMembers = [
    ...new Set((memberUserIds ?? []).filter((userId) => Boolean(userId))),
  ];
  const otherMembers = allMembers.filter((userId) => userId !== currentUserId);
  const members = otherMembers.length > 0 ? otherMembers : allMembers;
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
