import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/app/generated/prisma/client";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { createMainBucketImageAccessGrant } from "@/app/api/image_access_grant";
import { uploadImageToMainBucket } from "@/app/api/server_file_storage_utils";
import { PostCreateRequest, PostCreateResponse, PostData } from "@/app/types/interfaces";

const sanitizePostData = (rawData: unknown): Prisma.InputJsonValue | undefined => {
  if (!rawData || typeof rawData !== "object") {
    return undefined;
  }
  return rawData as Prisma.InputJsonValue;
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

    const post = await prisma.posts.create({
      data: {
        created_by: authResult.user_id,
        image_id: imageId,
        text: text ?? null,
        ...(data ? { data } : {}),
      },
      select: {
        id: true,
        created_at: true,
        created_by: true,
        image_id: true,
        text: true,
        data: true,
      },
    });

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

    const payload: PostCreateResponse = {
      post: {
        id: post.id,
        created_at: post.created_at.toISOString(),
        created_by: post.created_by,
        image_id: post.image_id,
        image_url: null,
        image_access_grant: imageAccessGrant,
        text: post.text ?? "",
        data: post.data as PostData | null,
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
