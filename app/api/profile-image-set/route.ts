import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import {
  getSignedMainBucketImageUrl,
  uploadImageToMainBucket,
} from "@/app/api/server_file_storage_utils";

type ProfileImageSetBody = {
  image_base64_data?: string;
  image_mime_type?: string;
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("profile_image_set_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ProfileImageSetBody;
    const imageBase64Data = body.image_base64_data?.trim();
    const imageMimeType = body.image_mime_type?.trim();

    if (!imageBase64Data || !imageMimeType) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "image_base64_data and image_mime_type are required.",
          },
        },
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

    await prisma.users.update({
      where: {
        id: authResult.user_id,
      },
      data: {
        profile_image_id: imageId,
      },
      select: {
        id: true,
      },
    });

    const imageUrl = await getSignedMainBucketImageUrl({
      userId: authResult.user_id,
      imageId,
    });

    return NextResponse.json(
      {
        profile_image_id: imageId,
        profile_image_url: imageUrl,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("profile_image_set_failed", error);
    return NextResponse.json(
      { error: { code: "profile_image_set_failed", message: "Failed to set profile image." } },
      { status: 500 },
    );
  }
}
