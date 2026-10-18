import { randomUUID } from "node:crypto";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/app/lib/prisma";
import { sendPushToUsers } from "@/app/lib/push_notifications";
import { sanitizeNotificationText } from "@/app/lib/notification_text";
import { resolvePostAudience } from "@/app/lib/postVisibility";
import { createMainBucketImageAccessGrant } from "@/app/api/image_access_grant";
import { uploadImageToMainBucket } from "@/app/api/server_file_storage_utils";
import {
  parsePollCreateInput,
  sanitizePostDataForViewer,
  validateAndBuildPoll,
} from "@/app/lib/polls";
import {
  parseTierListCreateInput,
  validateAndBuildTierList,
} from "@/app/lib/tierLists";
import {
  PollData,
  PostCreateRequest,
  PostCreateResponse,
  PostData,
  PostMediaItem,
  TierListData,
} from "@/app/types/interfaces";
import {
  buildCompatFieldsFromMedia,
  parsePostMediaItems,
  validatePostMediaForCreate,
} from "@/app/lib/postMedia";

const POST_PUSH_PREVIEW_MAX_LENGTH = 120;

const getPostPushPreviewText = (
  postText: string | null,
  hasImage: boolean,
  hasVideo: boolean,
  hasPoll: boolean,
  hasTierList: boolean,
): string => {
  const sanitizedText = sanitizeNotificationText(postText);
  if (sanitizedText) {
    return sanitizedText.slice(0, POST_PUSH_PREVIEW_MAX_LENGTH);
  }
  if (hasPoll) {
    return "Shared a poll";
  }
  if (hasTierList) {
    return "Shared a tier list";
  }
  if (hasVideo && hasImage) {
    return "Shared photos and video";
  }
  if (hasVideo) {
    return "Shared a video";
  }
  if (hasImage) {
    return "Shared a photo";
  }
  return "Shared a new post";
};

export type CreatePostForUserInput = {
  authorUserId: string;
  authorUsername: string;
  authorEmail: string | null;
  body: PostCreateRequest;
};

export type CreatePostForUserError = {
  ok: false;
  status: number;
  error: { code: string; message: string };
};

export type CreatePostForUserSuccess = {
  ok: true;
  response: PostCreateResponse;
};

export type CreatePostForUserResult = CreatePostForUserSuccess | CreatePostForUserError;

export async function createPostForUser(
  input: CreatePostForUserInput,
): Promise<CreatePostForUserResult> {
  const { authorUserId, authorUsername, authorEmail, body } = input;
  const text = body.text?.trim();
  const providedImageId = body.image_id?.trim();
  const imageBase64Data = body.image_base64_data?.trim();
  const imageMimeType = body.image_mime_type?.trim();
  const hasText = Boolean(text);
  const hasProvidedImageId = Boolean(providedImageId);
  const hasImageUploadPayload = Boolean(imageBase64Data || imageMimeType);

  const rawData =
    body.data && typeof body.data === "object" && !Array.isArray(body.data)
      ? (body.data as Record<string, unknown>)
      : {};

  const parsedMedia =
    rawData.media !== undefined ? parsePostMediaItems(rawData.media) : null;
  if (rawData.media !== undefined && !parsedMedia) {
    return {
      ok: false,
      status: 400,
      error: { code: "invalid_media", message: "Post media is invalid." },
    };
  }

  const otherImageIds = Array.isArray(rawData.other_image_ids)
    ? rawData.other_image_ids.filter(
        (id): id is string => typeof id === "string" && id.trim().length > 0,
      )
    : [];

  let builtPoll: PollData | null = null;
  if (rawData.poll !== undefined) {
    const pollInput = parsePollCreateInput(rawData.poll);
    if (!pollInput) {
      return {
        ok: false,
        status: 400,
        error: { code: "invalid_poll", message: "Poll configuration is invalid." },
      };
    }
    const pollResult = validateAndBuildPoll(pollInput);
    if ("error" in pollResult) {
      return { ok: false, status: 400, error: pollResult.error };
    }
    builtPoll = pollResult.poll;
  }

  let builtTierList: TierListData | null = null;
  if (rawData.tier_list !== undefined) {
    const tierListInput = parseTierListCreateInput(rawData.tier_list);
    if (!tierListInput) {
      return {
        ok: false,
        status: 400,
        error: {
          code: "invalid_tier_list",
          message: "Tier list configuration is invalid.",
        },
      };
    }
    const tierListResult = validateAndBuildTierList(tierListInput);
    if ("error" in tierListResult) {
      return { ok: false, status: 400, error: tierListResult.error };
    }
    builtTierList = tierListResult.tierList;
  }

  if (builtPoll && builtTierList) {
    return {
      ok: false,
      status: 400,
      error: {
        code: "invalid_request",
        message: "A post cannot include both a poll and a tier list.",
      },
    };
  }

  const mediaValidation = validatePostMediaForCreate({
    media: parsedMedia,
    hasPoll: Boolean(builtPoll),
    hasTierList: Boolean(builtTierList),
  });
  if (!mediaValidation.ok) {
    return {
      ok: false,
      status: 400,
      error: { code: mediaValidation.code, message: mediaValidation.message },
    };
  }
  const mediaItems: PostMediaItem[] | null = mediaValidation.media;

  if (builtPoll && !mediaItems && otherImageIds.length > 0) {
    return {
      ok: false,
      status: 400,
      error: {
        code: "invalid_poll",
        message: "Poll posts can include at most one image.",
      },
    };
  }

  if (builtTierList && !mediaItems && otherImageIds.length > 0) {
    return {
      ok: false,
      status: 400,
      error: {
        code: "invalid_tier_list",
        message: "Tier list posts can include at most one image.",
      },
    };
  }

  const hasMedia = Boolean(mediaItems && mediaItems.length > 0);
  if (
    !hasText &&
    !hasProvidedImageId &&
    !hasImageUploadPayload &&
    !builtPoll &&
    !builtTierList &&
    !hasMedia
  ) {
    return {
      ok: false,
      status: 400,
      error: {
        code: "invalid_request",
        message:
          "text and/or image_id or image_base64_data with image_mime_type, or a valid poll or tier list, is required.",
      },
    };
  }

  if (!providedImageId && hasImageUploadPayload && (!imageBase64Data || !imageMimeType)) {
    return {
      ok: false,
      status: 400,
      error: {
        code: "invalid_request",
        message: "image_base64_data and image_mime_type are required when uploading an image.",
      },
    };
  }

  const resolved = await resolvePostAudience({
    authorUserId,
    audience: body.audience,
  });
  if ("error" in resolved) {
    return { ok: false, status: 400, error: resolved.error };
  }
  const { audience } = resolved;
  const isPermanent = audience.mode === "permanent";

  let imageId: string | null = providedImageId ?? null;
  let resolvedOtherImageIds = otherImageIds;
  if (mediaItems && mediaItems.length > 0) {
    const compat = buildCompatFieldsFromMedia(mediaItems);
    imageId = compat.image_id;
    resolvedOtherImageIds = compat.other_image_ids;
  } else if (!providedImageId && imageBase64Data && imageMimeType) {
    imageId = randomUUID();
    await uploadImageToMainBucket({
      userId: authorUserId,
      imageId,
      base64Data: imageBase64Data,
      mimeType: imageMimeType,
    });
  }

  const postData: PostData = {};
  if (mediaItems && mediaItems.length > 0) {
    postData.media = mediaItems;
  }
  if (resolvedOtherImageIds.length > 0) {
    postData.other_image_ids = resolvedOtherImageIds;
  }
  if (builtPoll) {
    postData.poll = builtPoll;
  }
  if (builtTierList) {
    postData.tier_list = builtTierList;
  }
  const hasPostData = Object.keys(postData).length > 0;

  const post = await prisma.$transaction(async (tx) => {
    const created = await tx.posts.create({
      data: {
        created_by: authorUserId,
        image_id: imageId,
        text: text ?? null,
        permanent: isPermanent,
        ...(hasPostData ? { data: postData as Prisma.InputJsonValue } : {}),
      },
      select: {
        id: true,
        created_at: true,
        created_by: true,
        image_id: true,
        text: true,
        data: true,
        permanent: true,
      },
    });

    if (!isPermanent && audience.viewerIds.length > 0) {
      const createdAt = new Date();
      await tx.user_post_access.createMany({
        data: audience.viewerIds.map((viewerId) => ({
          post_id: created.id,
          viewer_id: viewerId,
          created_at: createdAt,
        })),
      });
    }

    return created;
  });

  const recipientUserIds = audience.viewerIds.filter((userId) => userId !== authorUserId);
  if (recipientUserIds.length > 0) {
    const hasVideo = Boolean(mediaItems?.some((item) => item.kind === "video"));
    const hasImageSlide = Boolean(
      mediaItems?.some((item) => item.kind === "image") || (!hasVideo && post.image_id),
    );
    const previewText = getPostPushPreviewText(
      post.text,
      hasImageSlide,
      hasVideo,
      Boolean(builtPoll),
      Boolean(builtTierList),
    );
    void sendPushToUsers({
      recipientUserIds,
      payload: {
        title: `${authorUsername} make a post`,
        body: previewText,
        url: "/?tab=feed",
      },
    }).catch((error) => {
      console.error("post_create_push_dispatch_failed", error);
    });
  }

  let imageAccessGrant: string | null = null;
  if (post.image_id) {
    try {
      imageAccessGrant = createMainBucketImageAccessGrant({
        imageId: post.image_id,
        storageUserId: post.created_by,
        viewerUserId: authorUserId,
      });
    } catch (error) {
      console.error("post_create_image_grant_failed", post.id, error);
    }
  }

  const author = await prisma.users.findFirst({
    where: { id: authorUserId },
    select: { profile_image_id: true },
  });
  let authorProfileImageAccessGrant: string | null = null;
  if (author?.profile_image_id) {
    try {
      authorProfileImageAccessGrant = createMainBucketImageAccessGrant({
        imageId: author.profile_image_id,
        storageUserId: authorUserId,
        viewerUserId: authorUserId,
      });
    } catch (error) {
      console.error("post_create_author_profile_image_grant_failed", authorUserId, error);
    }
  }

  const sanitizedData = sanitizePostDataForViewer({
    data: post.data,
    viewerUserId: authorUserId,
    authorUserId: post.created_by,
  });

  return {
    ok: true,
    response: {
      post: {
        id: post.id,
        created_at: post.created_at.toISOString(),
        created_by: post.created_by,
        image_id: post.image_id,
        image_url: null,
        image_access_grant: imageAccessGrant,
        text: post.text ?? "",
        data: sanitizedData,
        like_count: 0,
        is_liked_by_viewer: false,
        username: authorUsername,
        email: authorEmail,
        author_profile_image_id: author?.profile_image_id ?? null,
        author_profile_image_url: null,
        author_profile_image_access_grant: authorProfileImageAccessGrant,
      },
    },
  };
}
