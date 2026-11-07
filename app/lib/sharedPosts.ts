import type { Prisma } from "@/app/generated/prisma/client";
import type { EventAlbumPhase, PostData, PostMediaItem } from "@/app/types/interfaces";

/**
 * Event album helpers. The album lives on `thread_events.shared_post_data` (post-shaped:
 * media / likes / comments) and is gated by `blind_reveal`, `close_at`, `release_at`.
 */

export type EventAlbumTiming = {
  blind_reveal: boolean;
  close_at: Date | null;
  release_at: Date | null;
};

export const MAX_SHARED_POST_MEDIA_TOTAL = 100;
export const MAX_SHARED_POST_MEDIA_PER_CONTRIBUTOR = 5;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Non-blind events are always "open". Blind events need both `close_at` and `release_at`;
 * when either is missing the album is treated as "pending" (hidden, not contributable).
 */
export const getEventAlbumPhase = (
  event: EventAlbumTiming,
  now: Date = new Date(),
): EventAlbumPhase => {
  if (!event.blind_reveal) {
    return "open";
  }
  if (!event.close_at || !event.release_at) {
    return "pending";
  }
  if (now < event.close_at) {
    return "open";
  }
  if (now < event.release_at) {
    return "pending";
  }
  return "released";
};

/** Media / likes / comments are visible when the event is not blind, or once released. */
export const isEventAlbumMediaVisible = (
  event: EventAlbumTiming,
  now: Date = new Date(),
): boolean => !event.blind_reveal || getEventAlbumPhase(event, now) === "released";

/** Contributions are allowed for non-blind events, or for blind events before close_at. */
export const canContributeToEventAlbum = (
  event: EventAlbumTiming,
  now: Date = new Date(),
): boolean => {
  if (!event.blind_reveal) {
    return true;
  }
  if (!event.close_at || !event.release_at) {
    return false;
  }
  return getEventAlbumPhase(event, now) === "open";
};

export const validateSharedPostDates = (
  closeAt: Date,
  releaseAt: Date,
): { ok: true } | { ok: false; code: string; message: string } => {
  if (Number.isNaN(closeAt.getTime()) || Number.isNaN(releaseAt.getTime())) {
    return { ok: false, code: "invalid_dates", message: "close_at and release_at must be valid dates." };
  }
  // Allow past dates (useful for testing phase transitions). Only require release after close.
  if (releaseAt <= closeAt) {
    return {
      ok: false,
      code: "invalid_release_at",
      message: "release_at must be after close_at.",
    };
  }
  return { ok: true };
};

export const asEventSharedPostData = (value: Prisma.JsonValue | null | undefined): PostData => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as PostData;
};

export const parseSharedPostMediaItems = (raw: unknown): PostMediaItem[] | null => {
  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }

  const items: PostMediaItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return null;
    }
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const kind = record.kind;
    const ownerUserId =
      typeof record.owner_user_id === "string" ? record.owner_user_id.trim() : "";
    if (!id || !UUID_RE.test(id) || (kind !== "image" && kind !== "video")) {
      return null;
    }
    if (!ownerUserId || !UUID_RE.test(ownerUserId)) {
      return null;
    }
    if (kind === "image") {
      items.push({ id, kind: "image", owner_user_id: ownerUserId });
      continue;
    }
    const posterId = typeof record.poster_id === "string" ? record.poster_id.trim() : "";
    if (!posterId || !UUID_RE.test(posterId)) {
      return null;
    }
    items.push({ id, kind: "video", poster_id: posterId, owner_user_id: ownerUserId });
  }
  return items;
};

export const countContributorMedia = (media: PostMediaItem[], userId: string): number =>
  media.filter((item) => item.owner_user_id === userId).length;

export const appendSharedPostMedia = ({
  existingData,
  newMedia,
  contributorUserId,
}: {
  existingData: PostData;
  newMedia: PostMediaItem[];
  contributorUserId: string;
}):
  | { ok: true; data: PostData; imageId: string | null }
  | { ok: false; code: string; message: string } => {
  if (newMedia.length === 0) {
    return { ok: false, code: "invalid_media", message: "At least one photo or video is required." };
  }

  for (const item of newMedia) {
    if (item.owner_user_id !== contributorUserId) {
      return {
        ok: false,
        code: "invalid_media_owner",
        message: "Media owner_user_id must match the contributing user.",
      };
    }
  }

  const existingMedia = Array.isArray(existingData.media) ? existingData.media : [];
  if (existingMedia.length + newMedia.length > MAX_SHARED_POST_MEDIA_TOTAL) {
    return {
      ok: false,
      code: "media_limit",
      message: `Event albums can include at most ${MAX_SHARED_POST_MEDIA_TOTAL} photos or videos.`,
    };
  }

  const existingForUser = countContributorMedia(existingMedia, contributorUserId);
  if (existingForUser + newMedia.length > MAX_SHARED_POST_MEDIA_PER_CONTRIBUTOR) {
    return {
      ok: false,
      code: "contributor_media_limit",
      message: `You can contribute at most ${MAX_SHARED_POST_MEDIA_PER_CONTRIBUTOR} photos or videos.`,
    };
  }

  const nextMedia = [...existingMedia, ...newMedia];
  const first = nextMedia[0];
  const imageId =
    !first ? null : first.kind === "video" ? (first.poster_id ?? null) : first.id;

  return {
    ok: true,
    imageId,
    data: {
      ...existingData,
      media: nextMedia,
    },
  };
};

/** Drop media owned by removed members and recompute the primary image id. */
export const stripMediaForRemovedContributors = (
  existingData: PostData,
  removedUserIds: Set<string>,
): { data: PostData; imageId: string | null } => {
  const media = Array.isArray(existingData.media) ? existingData.media : [];
  const nextMedia =
    removedUserIds.size === 0
      ? media
      : media.filter((item) => !item.owner_user_id || !removedUserIds.has(item.owner_user_id));
  const first = nextMedia[0];
  const imageId = !first ? null : first.kind === "video" ? (first.poster_id ?? null) : first.id;
  if (removedUserIds.size === 0) {
    return { data: existingData, imageId };
  }
  return {
    imageId,
    data: {
      ...existingData,
      media: nextMedia.length > 0 ? nextMedia : undefined,
    },
  };
};

export const stripSharedPostMediaForBlindView = (data: PostData | null): PostData | null => {
  if (!data) {
    return null;
  }
  const { media: _media, other_image_ids: _other, ...rest } = data;
  return rest;
};

export const contributorHasUploaded = (data: PostData | null | undefined, userId: string): boolean => {
  const media = data?.media;
  if (!Array.isArray(media) || media.length === 0) {
    return false;
  }
  return media.some((item) => item.owner_user_id === userId);
};

export const findSharedMediaOwnerUserId = (
  data: PostData | null | undefined,
  objectId: string,
): string | null => {
  const media = data?.media;
  if (!Array.isArray(media)) {
    return null;
  }
  for (const item of media) {
    if (item.id === objectId) {
      return item.owner_user_id ?? null;
    }
    if (item.kind === "video" && item.poster_id === objectId) {
      return item.owner_user_id ?? null;
    }
  }
  return null;
};
