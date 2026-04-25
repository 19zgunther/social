import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/app/generated/prisma/client";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { sendPushToUsers } from "@/app/lib/push_notifications";
import { sanitizeNotificationText } from "@/app/lib/notification_text";
import { createMainBucketImageAccessGrant } from "@/app/api/image_access_grant";
import { uploadImageToMainBucket } from "@/app/api/server_file_storage_utils";
import { PostCreateRequest, PostCreateResponse, PostData } from "@/app/types/interfaces";

const sanitizePostData = (rawData: unknown): Prisma.InputJsonValue | undefined => {
  if (!rawData || typeof rawData !== "object") {
    return undefined;
  }
  return rawData as Prisma.InputJsonValue;
};

const POST_PUSH_PREVIEW_MAX_LENGTH = 120;
const getPostPushPreviewText = (postText: string | null, hasImage: boolean): string => {
  const sanitizedText = sanitizeNotificationText(postText);
  if (sanitizedText) {
    return sanitizedText.slice(0, POST_PUSH_PREVIEW_MAX_LENGTH);
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
    const data = sanitizePostData(body.data);
    const threadIds = Array.isArray(body.thread_ids)
      ? Array.from(new Set(body.thread_ids.map((value) => value?.trim()).filter(Boolean) as string[]))
      : [];
    const hasText = Boolean(text);
    const hasProvidedImageId = Boolean(providedImageId);
    const hasImageUploadPayload = Boolean(imageBase64Data || imageMimeType);

    if (!hasText && !hasProvidedImageId && !hasImageUploadPayload) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "text and/or image_id or image_base64_data with image_mime_type is required.",
          },
        },
        { status: 400 },
      );
    }
    if (threadIds.length === 0) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "thread_ids is required.",
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

    const accessibleThreads = await prisma.threads.findMany({
      where: {
        id: { in: threadIds },
        OR: [{ owner: authResult.user_id }, { user_thread_access: { some: { user_id: authResult.user_id } } }],
      },
      select: {
        id: true,
        name: true,
        user_thread_access: {
          select: { user_id: true },
        },
        owner: true,
      },
    });
    if (accessibleThreads.length !== threadIds.length) {
      return NextResponse.json(
        { error: { code: "thread_not_found", message: "One or more groups are not accessible." } },
        { status: 404 },
      );
    }
    const postId = randomUUID();
    const createdAt = new Date();
    const sectionRowByThreadId = new Map(
      accessibleThreads.map((thread) => {
        const id = randomUUID();
        return [thread.id, { id, thread }] as const;
      }),
    );
    await prisma.thread_messages.createMany({
      data: accessibleThreads.map((thread) => {
        const row = sectionRowByThreadId.get(thread.id)!;
        return {
          id: row.id,
          created_at: createdAt,
          updated_at: createdAt,
          created_by: authResult.user_id,
          parent_id: thread.id,
          post_id: postId,
          image_id: imageId,
          text: text ?? null,
          root_parent_id: null,
          ...(data ? { data } : {}),
        };
      }),
    });

    const recipientUserIds = Array.from(new Set(
      accessibleThreads.flatMap((thread) => [thread.owner, ...thread.user_thread_access.map((row) => row.user_id)]),
    )).filter((userId) => userId !== authResult.user_id);
    if (recipientUserIds.length > 0) {
      const previewText = getPostPushPreviewText(text ?? null, Boolean(imageId));
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
    if (imageId) {
      try {
        imageAccessGrant = createMainBucketImageAccessGrant({
          imageId: imageId,
          storageUserId: authResult.user_id,
          viewerUserId: authResult.user_id,
        });
      } catch (error) {
        console.error("post_create_image_grant_failed", postId, error);
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

    const payload: PostCreateResponse = {
      post: {
        id: postId,
        created_at: createdAt.toISOString(),
        created_by: authResult.user_id,
        image_id: imageId,
        image_url: null,
        image_access_grant: imageAccessGrant,
        text: text ?? "",
        data: (data as PostData | undefined) ?? null,
        like_count: 0,
        is_liked_by_viewer: false,
        username: authResult.username,
        email: authResult.email,
        author_profile_image_id: author?.profile_image_id ?? null,
        author_profile_image_url: null,
        author_profile_image_access_grant: authorProfileImageAccessGrant,
        group_sections: accessibleThreads.map((thread) => ({
          id: sectionRowByThreadId.get(thread.id)!.id,
          thread_id: thread.id,
          thread_name: thread.name,
          created_at: createdAt.toISOString(),
          data: (data as PostData | undefined) ?? {},
          like_count: 0,
          is_liked_by_viewer: false,
        })),
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
