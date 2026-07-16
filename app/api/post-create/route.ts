import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/app/generated/prisma/client";
import { authCheck } from "@/app/api/auth_utils";
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
import { PollData, PostCreateRequest, PostCreateResponse, PostData } from "@/app/types/interfaces";

const POST_PUSH_PREVIEW_MAX_LENGTH = 120;
const getPostPushPreviewText = (
  postText: string | null,
  hasImage: boolean,
  hasPoll: boolean,
): string => {
  const sanitizedText = sanitizeNotificationText(postText);
  if (sanitizedText) {
    return sanitizedText.slice(0, POST_PUSH_PREVIEW_MAX_LENGTH);
  }
  if (hasPoll) {
    return "Shared a poll";
  }
  if (hasImage) {
    return "Shared a photo";
  }
  return "Shared a new post";
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("post_create_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as PostCreateRequest;
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

    const otherImageIds = Array.isArray(rawData.other_image_ids)
      ? rawData.other_image_ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      : [];

    let builtPoll: PollData | null = null;
    if (rawData.poll !== undefined) {
      const pollInput = parsePollCreateInput(rawData.poll);
      if (!pollInput) {
        return NextResponse.json(
          {
            error: {
              code: "invalid_poll",
              message: "Poll configuration is invalid.",
            },
          },
          { status: 400 },
        );
      }
      const pollResult = validateAndBuildPoll(pollInput);
      if ("error" in pollResult) {
        return NextResponse.json({ error: pollResult.error }, { status: 400 });
      }
      builtPoll = pollResult.poll;
    }

    if (builtPoll && otherImageIds.length > 0) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_poll",
            message: "Poll posts can include at most one image.",
          },
        },
        { status: 400 },
      );
    }

    if (!hasText && !hasProvidedImageId && !hasImageUploadPayload && !builtPoll) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message:
              "text and/or image_id or image_base64_data with image_mime_type, or a valid poll, is required.",
          },
        },
        { status: 400 },
      );
    }

    if (!providedImageId && hasImageUploadPayload && (!imageBase64Data || !imageMimeType)) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "image_base64_data and image_mime_type are required when uploading an image.",
          },
        },
        { status: 400 },
      );
    }

    const resolved = await resolvePostAudience({
      authorUserId: authResult.user_id,
      audience: body.audience,
    });
    if ("error" in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: 400 });
    }
    const { audience } = resolved;
    const isPermanent = audience.mode === "permanent";

    let imageId: string | null = providedImageId ?? null;
    if (!providedImageId && imageBase64Data && imageMimeType) {
      imageId = randomUUID();
      await uploadImageToMainBucket({
        userId: authResult.user_id,
        imageId: imageId,
        base64Data: imageBase64Data,
        mimeType: imageMimeType,
      });
    }

    const postData: PostData = {};
    if (otherImageIds.length > 0) {
      postData.other_image_ids = otherImageIds;
    }
    if (builtPoll) {
      postData.poll = builtPoll;
    }
    const hasPostData = Object.keys(postData).length > 0;

    const post = await prisma.$transaction(async (tx) => {
      const created = await tx.posts.create({
        data: {
          created_by: authResult.user_id,
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

    const recipientUserIds = audience.viewerIds.filter((userId) => userId !== authResult.user_id);
    if (recipientUserIds.length > 0) {
      const previewText = getPostPushPreviewText(post.text, Boolean(post.image_id), Boolean(builtPoll));
      void sendPushToUsers({
        recipientUserIds,
        payload: {
          title: `${authResult.username} make a post`,
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
          viewerUserId: authResult.user_id,
        });
      } catch (error) {
        console.error("post_create_image_grant_failed", post.id, error);
      }
    }

    const author = await prisma.users.findFirst({
      where: {
        id: authResult.user_id,
      },
      select: {
        profile_image_id: true,
      },
    });
    let authorProfileImageAccessGrant: string | null = null;
    if (author?.profile_image_id) {
      try {
        authorProfileImageAccessGrant = createMainBucketImageAccessGrant({
          imageId: author.profile_image_id,
          storageUserId: authResult.user_id,
          viewerUserId: authResult.user_id,
        });
      } catch (error) {
        console.error("post_create_author_profile_image_grant_failed", authResult.user_id, error);
      }
    }

    const sanitizedData = sanitizePostDataForViewer({
      data: post.data,
      viewerUserId: authResult.user_id,
      authorUserId: post.created_by,
    });

    const payload: PostCreateResponse = {
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
        username: authResult.username,
        email: authResult.email,
        author_profile_image_id: author?.profile_image_id ?? null,
        author_profile_image_url: null,
        author_profile_image_access_grant: authorProfileImageAccessGrant,
      },
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("post_create_failed", error);
    return NextResponse.json(
      { error: { code: "post_create_failed", message: "Failed to create post." } },
      { status: 500 },
    );
  }
}
