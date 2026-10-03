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

/** Derive ordered slides from `data.media`, or legacy image_id + other_image_ids. */
export const getPostMediaSlides = (input: {
  imageId: string | null | undefined;
  data: PostData | null | undefined;
}): PostMediaSlide[] => {
  const media = input.data?.media;
  if (Array.isArray(media) && media.length > 0) {
    return media.map((item, index) => ({
      key: `${item.kind}-${item.id}-${index}`,
      kind: item.kind,
      mediaId: item.id,
      posterId: item.kind === "video" ? item.poster_id : undefined,
      ownerUserId: item.owner_user_id,
    }));
  }

  const slides: PostMediaSlide[] = [];
  if (input.imageId) {
    slides.push({ key: `image-${input.imageId}`, kind: "image", mediaId: input.imageId });
  }
  for (const imageId of input.data?.other_image_ids ?? []) {
    if (!imageId || slides.some((slide) => slide.mediaId === imageId)) {
      continue;
    }
    slides.push({ key: `image-${imageId}`, kind: "image", mediaId: imageId });
  }
  return slides;
};

/** Primary still + legacy other_image_ids for grids / older readers. */
export const buildCompatFieldsFromMedia = (
  media: PostMediaItem[],
): { image_id: string | null; other_image_ids: string[] } => {
  const first = media[0];
  const imageId =
    !first ? null : first.kind === "video" ? (first.poster_id ?? null) : first.id;
  const otherImageIds = media
    .filter((item) => item.kind === "image" && item.id !== imageId)
    .map((item) => item.id);
  return { image_id: imageId, other_image_ids: otherImageIds };
};

/** Storage object ids that need access grants (media + posters). */
export const collectPostMediaObjectIds = (input: {
  imageId: string | null | undefined;
  data: PostData | null | undefined;
}): string[] => {
  const ids: string[] = [];
  const push = (id: string | null | undefined) => {
    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  };

  const media = input.data?.media;
  if (Array.isArray(media) && media.length > 0) {
    for (const item of media) {
      push(item.id);
      if (item.kind === "video") {
        push(item.poster_id);
      }
    }
    return ids;
  }

  push(input.imageId);
  for (const imageId of input.data?.other_image_ids ?? []) {
    push(imageId);
  }
  return ids;
};

export const validatePostMediaForCreate = ({
  media,
  hasPoll,
}: {
  media: PostMediaItem[] | null;
  hasPoll: boolean;
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
  return { ok: true, media };
};
