import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { authCheck } from "@/app/api/auth_utils";
import {
  getSignedMainBucketImageUrl,
  uploadImageToMainBucket,
} from "@/app/api/server_file_storage_utils";
import { ImageUploadRequest, ImageUploadResponse } from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("image_upload_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ImageUploadRequest;
    const imageBase64Data = body.image_base64_data?.trim();
    const imageMimeType = body.image_mime_type?.trim();
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
    const imageUrl = await getSignedMainBucketImageUrl({
      userId: authResult.user_id,
      imageId,
    });

    const payload: ImageUploadResponse = {
      image_id: imageId,
      image_url: imageUrl,
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("image_upload_failed", error);
    return NextResponse.json(
      { error: { code: "image_upload_failed", message: "Failed to upload image." } },
      { status: 500 },
    );
  }
}
