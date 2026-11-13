import type { PostData, PostMediaItem, PostMediaKind } from "@/app/types/interfaces";

export const MAX_POST_MEDIA_ITEMS = 10;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const MAX_VIDEO_DURATION_SECONDS = 60;
export const ALLOWED_VIDEO_MIME_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isAllowedVideoMimeType = (mimeType: string): boolean =>
  (ALLOWED_VIDEO_MIME_TYPES as readonly string[]).includes(mimeType);

export type PostMediaSlide = {
  key: string;
  kind: PostMediaKind;
  mediaId: string;
  posterId?: string;
  ownerUserId?: string;
};

export type PostCoverObject = {
  objectId: string;
  /** Present when media item sets owner_user_id (shared-event albums). */
  ownerUserId?: string;
};

export const parsePostMediaItems = (raw: unknown): PostMediaItem[] | null => {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_POST_MEDIA_ITEMS) {
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
    if (!id || !UUID_RE.test(id) || (kind !== "image" && kind !== "video")) {
      return null;
    }
    if (kind === "image") {
      items.push({ id, kind: "image" });
      continue;
    }
    const posterId = typeof record.poster_id === "string" ? record.poster_id.trim() : "";
    if (!posterId || !UUID_RE.test(posterId)) {
      return null;
    }
    items.push({ id, kind: "video", poster_id: posterId });
  }
  return items;
};

/** True when `data.media` already has at least one slide. */
export const postDataHasMedia = (data: PostData | null | undefined): boolean =>
  Array.isArray(data?.media) && data.media.length > 0;

/**
 * Build `data.media` from dead legacy fields (`posts.image_id` + `other_image_ids`).
 * Used by the one-off backfill script only — app code should not read those fields.
 */
export const buildMediaFromLegacyFields = (input: {
  imageId: string | null | undefined;
  otherImageIds?: unknown;
}): PostMediaItem[] => {
  const media: PostMediaItem[] = [];
  const pushImage = (id: string | null | undefined) => {
    const trimmed = typeof id === "string" ? id.trim() : "";
    if (!trimmed || media.some((item) => item.id === trimmed)) {
      return;
    }
    media.push({ id: trimmed, kind: "image" });
  };

  pushImage(input.imageId);
  if (Array.isArray(input.otherImageIds)) {
    for (const entry of input.otherImageIds) {
      if (typeof entry === "string") {
        pushImage(entry);
      }
    }
  }
  return media;
};

/** Cover still for grids: first image id, or first video poster. */
export const getPostCoverObject = (data: PostData | null | undefined): PostCoverObject | null => {
  const first = data?.media?.[0];
  if (!first) {
    return null;
  }
  if (first.kind === "video") {
    const posterId = first.poster_id?.trim();
    if (!posterId) {
      return null;
    }
    return {
      objectId: posterId,
      ...(first.owner_user_id ? { ownerUserId: first.owner_user_id } : {}),
    };
  }
  return {
    objectId: first.id,
    ...(first.owner_user_id ? { ownerUserId: first.owner_user_id } : {}),
  };
};

/** Seed client grant maps from list/create cover fields for first paint. */
export const seedCoverImageGrant = (post: {
  cover_image_id?: string | null;
  cover_image_access_grant?: string | null;
}): Record<string, string> => {
  if (post.cover_image_id && post.cover_image_access_grant) {
    return { [post.cover_image_id]: post.cover_image_access_grant };
  }
  return {};
};

/** Ordered slides from `data.media` only (legacy image_id / other_image_ids are dead). */
export const getPostMediaSlides = (input: {
  data: PostData | null | undefined;
}): PostMediaSlide[] => {
  const media = input.data?.media;
  if (!Array.isArray(media) || media.length === 0) {
    return [];
  }
  return media.map((item, index) => ({
    key: `${item.kind}-${item.id}-${index}`,
    kind: item.kind,
    mediaId: item.id,
    posterId: item.kind === "video" ? item.poster_id : undefined,
    ownerUserId: item.owner_user_id,
  }));
};

/** Storage object ids that need access grants (media + posters). */
export const collectPostMediaObjectIds = (input: {
  data: PostData | null | undefined;
}): string[] => {
  const ids: string[] = [];
  const push = (id: string | null | undefined) => {
    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  };

  const media = input.data?.media;
  if (!Array.isArray(media) || media.length === 0) {
    return ids;
  }
  for (const item of media) {
    push(item.id);
    if (item.kind === "video") {
      push(item.poster_id);
    }
  }
  return ids;
};

export const validatePostMediaForCreate = ({
  media,
  hasPoll,
  hasTierList = false,
}: {
  media: PostMediaItem[] | null;
  hasPoll: boolean;
  hasTierList?: boolean;
}): { ok: true; media: PostMediaItem[] | null } | { ok: false; code: string; message: string } => {
  if (!media || media.length === 0) {
    return { ok: true, media: null };
  }
  if (media.length > MAX_POST_MEDIA_ITEMS) {
    return {
      ok: false,
      code: "invalid_media",
      message: `Posts can include at most ${MAX_POST_MEDIA_ITEMS} photos or videos.`,
    };
  }
  if (hasPoll && (media.length > 1 || media.some((item) => item.kind === "video"))) {
    return {
      ok: false,
      code: "invalid_poll",
      message: media.some((item) => item.kind === "video")
        ? "Poll posts cannot include video."
        : "Poll posts can include at most one image.",
    };
  }
  if (hasTierList && (media.length > 1 || media.some((item) => item.kind === "video"))) {
    return {
      ok: false,
      code: "invalid_tier_list",
      message: media.some((item) => item.kind === "video")
        ? "Tier list posts cannot include video."
        : "Tier list posts can include at most one image.",
    };
  }
  return { ok: true, media };
};
