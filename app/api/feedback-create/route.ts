import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import {
  getSignedMainBucketImageUrl,
  uploadImageToMainBucket,
} from "@/app/api/server_file_storage_utils";

type Body = {
  text?: string;
  image_base64_data?: string;
  image_mime_type?: string;
};

const MAX_LEN = 8000;

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("feedback_create_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as Body;
    const text = body.text?.trim() ?? "";
    const imageBase64Data = body.image_base64_data?.trim();
    const imageMimeType = body.image_mime_type?.trim();

    if (!text && (!imageBase64Data || !imageMimeType)) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "text and/or image_base64_data with image_mime_type is required.",
          },
        },
        { status: 400 },
      );
    }

    if (text.length > MAX_LEN) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: `text must be at most ${MAX_LEN} characters.` } },
        { status: 400 },
      );
    }

    let imageId: string | null = null;
    if (imageBase64Data && imageMimeType) {
      imageId = randomUUID();
      await uploadImageToMainBucket({
        userId: authResult.user_id,
        imageId,
        base64Data: imageBase64Data,
        mimeType: imageMimeType,
      });
    }

    const row = await prisma.shared_feedback.create({
      data: {
        created_by: authResult.user_id,
        text,
        status: "unresolved",
        ...(imageId ? { image_id: imageId } : {}),
      },
      select: {
        id: true,
        created_at: true,
        created_by: true,
        text: true,
        status: true,
        image_id: true,
        users: { select: { username: true } },
      },
    });

    let imageUrl: string | null = null;
    if (row.image_id) {
      try {
        imageUrl = await getSignedMainBucketImageUrl({
          userId: row.created_by,
          imageId: row.image_id,
        });
      } catch (error) {
        console.error("feedback_create_image_sign_failed", authResult.user_id, error);
      }
    }

    return NextResponse.json(
      {
        item: {
          id: row.id,
          created_at: row.created_at.toISOString(),
          created_by: row.created_by,
          text: row.text,
          status: row.status as "resolved" | "unresolved",
          username: row.users.username,
          image_id: row.image_id,
          image_url: imageUrl,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("feedback_create_failed", error);
    return NextResponse.json(
      { error: { code: "feedback_create_failed", message: "Failed to create feedback." } },
      { status: 500 },
    );
  }
}
