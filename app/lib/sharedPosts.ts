import { Prisma } from "@/app/generated/prisma/client";
import { createMainBucketImageAccessGrant } from "@/app/api/image_access_grant";
import { sanitizePostDataForViewer } from "@/app/lib/polls";
import type {
  PostData,
  PostMediaItem,
  SharedPostContributorItem,
  SharedPostListItem,
} from "@/app/types/interfaces";

export type SharedPostRowForSerialize = {
  id: string;
  created_at: Date;
  created_by: string;
  title: string;
  text: string | null;
  image_id: string | null;
  data: Prisma.JsonValue | null;
  close_at: Date;
  release_at: Date;
  users: {
    username: string;
    email: string | null;
    profile_image_id: string | null;
  };
  shared_posts_contributors: Array<{
    user_id: string;
    invited_at: Date;
    users: {
      username: string;
      email: string | null;
      profile_image_id: string | null;
    };
  }>;
};

export const MAX_SHARED_POST_MEDIA_TOTAL = 100;
export const MAX_SHARED_POST_MEDIA_PER_CONTRIBUTOR = 5;

export type SharedPostPhase = "open" | "pending" | "released";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const getSharedPostPhase = (
  closeAt: Date,
  releaseAt: Date,
  now: Date = new Date(),
): SharedPostPhase => {
  if (now < closeAt) {
    return "open";
  }
  if (now < releaseAt) {
    return "pending";
  }
  return "released";
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

export const asSharedPostDataObject = (value: Prisma.JsonValue | null | undefined): PostData => {
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

/** Drop media owned by removed invitees and recompute primary image_id. */
export const stripMediaForRemovedContributors = (
  existingData: PostData,
  removedUserIds: Set<string>,
): { data: PostData; imageId: string | null } => {
  if (removedUserIds.size === 0) {
    const media = Array.isArray(existingData.media) ? existingData.media : [];
    const first = media[0];
    const imageId =
      !first ? null : first.kind === "video" ? (first.poster_id ?? null) : first.id;
    return { data: existingData, imageId };
  }

  const nextMedia = (Array.isArray(existingData.media) ? existingData.media : []).filter(
    (item) => !item.owner_user_id || !removedUserIds.has(item.owner_user_id),
  );
  const first = nextMedia[0];
  const imageId =
    !first ? null : first.kind === "video" ? (first.poster_id ?? null) : first.id;

  return {
    imageId,
    data: {
      ...existingData,
      media: nextMedia.length > 0 ? nextMedia : undefined,
    },
  };
};

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
      message: `Shared posts can include at most ${MAX_SHARED_POST_MEDIA_TOTAL} photos or videos.`,
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

const tryMintGrant = (
  imageId: string | null | undefined,
  storageUserId: string,
  viewerUserId: string,
): string | null => {
  if (!imageId) {
    return null;
  }
  try {
    return createMainBucketImageAccessGrant({
      imageId,
      storageUserId,
      viewerUserId,
    });
  } catch (error) {
    console.error("shared_post_image_grant_failed", imageId, error);
    return null;
  }
};

export const serializeSharedPostListItem = ({
  row,
  viewerUserId,
  includeContributors = false,
}: {
  row: SharedPostRowForSerialize;
  viewerUserId: string;
  includeContributors?: boolean;
}): SharedPostListItem => {
  const phase = getSharedPostPhase(row.close_at, row.release_at);
  const dataObject = asSharedPostDataObject(row.data);
  const isReleased = phase === "released";
  const likes = dataObject.likes ?? {};
  const likeCount = Object.values(likes).filter(Boolean).length;
  const isLikedByViewer = Boolean(likes[viewerUserId]);

  const contributors: SharedPostContributorItem[] | undefined = includeContributors
    ? row.shared_posts_contributors.map((contributor) => ({
        user_id: contributor.user_id,
        username: contributor.users.username,
        email: contributor.users.email,
        invited_at: contributor.invited_at.toISOString(),
        has_contributed: contributorHasUploaded(dataObject, contributor.user_id),
        profile_image_id: contributor.users.profile_image_id,
        profile_image_access_grant: tryMintGrant(
          contributor.users.profile_image_id,
          contributor.user_id,
          viewerUserId,
        ),
      }))
    : undefined;

  return {
    id: row.id,
    created_at: row.created_at.toISOString(),
    created_by: row.created_by,
    title: row.title,
    text: isReleased ? (row.text ?? "") : "",
    close_at: row.close_at.toISOString(),
    release_at: row.release_at.toISOString(),
    phase,
    contributor_count: row.shared_posts_contributors.length,
    viewer_has_contributed: contributorHasUploaded(dataObject, viewerUserId),
    is_creator: row.created_by === viewerUserId,
    image_id: isReleased ? row.image_id : null,
    image_url: null,
    image_access_grant: isReleased
      ? tryMintGrant(
          row.image_id,
          findSharedMediaOwnerUserId(dataObject, row.image_id ?? "") ?? row.created_by,
          viewerUserId,
        )
      : null,
    data: isReleased
      ? sanitizePostDataForViewer({
          data: row.data,
          viewerUserId,
          authorUserId: row.created_by,
        })
      : stripSharedPostMediaForBlindView(dataObject),
    like_count: isReleased ? likeCount : undefined,
    is_liked_by_viewer: isReleased ? isLikedByViewer : undefined,
    username: row.users.username,
    email: row.users.email,
    author_profile_image_id: row.users.profile_image_id,
    author_profile_image_access_grant: tryMintGrant(
      row.users.profile_image_id,
      row.created_by,
      viewerUserId,
    ),
    contributors,
  };
};

export const sharedPostSelectForSerialize = {
  id: true,
  created_at: true,
  created_by: true,
  title: true,
  text: true,
  image_id: true,
  data: true,
  close_at: true,
  release_at: true,
  users: {
    select: {
      username: true,
      email: true,
      profile_image_id: true,
    },
  },
  shared_posts_contributors: {
    select: {
      user_id: true,
      invited_at: true,
      users: {
        select: {
          username: true,
          email: true,
          profile_image_id: true,
        },
      },
    },
  },
} as const;
