import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/app/generated/prisma/client";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import {
  getSignedMainBucketImageUrl,
  uploadImageToMainBucket,
} from "@/app/api/server_file_storage_utils";

type PostCreateBody = {
  text?: string;
  image_base64_data?: string;
  image_mime_type?: string;
  data?: unknown;
};

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
    const body = (await request.json()) as PostCreateBody;
    const text = body.text?.trim();
    const imageBase64Data = body.image_base64_data?.trim();
    const imageMimeType = body.image_mime_type?.trim();
    const data = sanitizePostData(body.data);

    if (!imageBase64Data || !imageMimeType) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "image_base64_data and image_mime_type are required." } },
        { status: 400 },
      );
    }

    const imageId = randomUUID();
    await uploadImageToMainBucket({
      userId: authResult.user_id,
      imageId,
      base64Data: imageBase64Data,
      mimeType: imageMimeType,
    });

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

    const imageUrl = await getSignedMainBucketImageUrl({
      userId: post.created_by,
      imageId: post.image_id ?? "",
    });

    return NextResponse.json(
      {
        post: {
          id: post.id,
          created_at: post.created_at,
          created_by: post.created_by,
          image_id: post.image_id,
          image_url: imageUrl,
          text: post.text ?? "",
          data: post.data,
          username: authResult.username,
          email: authResult.email,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("post_create_failed", error);
    return NextResponse.json(
      { error: { code: "post_create_failed", message: "Failed to create post." } },
      { status: 500 },
    );
  }
}
