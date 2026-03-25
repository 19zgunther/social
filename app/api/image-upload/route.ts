import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { authCheck } from "@/app/api/auth_utils";
import {
  createSignedMainBucketUploadUrl,
  getSignedMainBucketImageUrl,
  uploadImageToMainBucket,
} from "@/app/api/server_file_storage_utils";
import type {
  ImageUploadCompleteRequest,
  ImageUploadRequest,
  ImageUploadResponse,
  ImageUploadSignRequest,
  ImageUploadSignResponse,
} from "@/app/types/interfaces";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isSignRequest = (body: ImageUploadRequest): body is ImageUploadSignRequest =>
  "phase" in body && body.phase === "sign";

const isCompleteRequest = (body: ImageUploadRequest): body is ImageUploadCompleteRequest =>
  "phase" in body && body.phase === "complete";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("image_upload_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ImageUploadRequest;

    if (isSignRequest(body)) {
      const imageMimeType = body.image_mime_type?.trim() ?? "";
      if (!imageMimeType.startsWith("image/")) {
        return NextResponse.json(
          {
            error: {
              code: "invalid_request",
              message: "image_mime_type must be an image/* MIME type.",
            },
          },
          { status: 400 },
        );
      }

      const imageId = randomUUID();
      const signed = await createSignedMainBucketUploadUrl({
        userId: authResult.user_id,
        imageId,
      });

      const payload: ImageUploadSignResponse = {
        image_id: imageId,
        signed_upload_url: signed.signedUrl,
        upload_token: signed.token,
        storage_path: signed.path,
      };
      return NextResponse.json(payload, { status: 200 });
    }

    if (isCompleteRequest(body)) {
      const imageId = body.image_id?.trim() ?? "";
      if (!imageId || !UUID_RE.test(imageId)) {
        return NextResponse.json(
          { error: { code: "invalid_request", message: "image_id must be a valid UUID." } },
          { status: 400 },
        );
      }

      const imageUrl = await getSignedMainBucketImageUrl({
        userId: authResult.user_id,
        imageId,
      });

      const payload: ImageUploadResponse = {
        image_id: imageId,
        image_url: imageUrl,
      };
      return NextResponse.json(payload, { status: 200 });
    }

    const imageBase64Data = body.image_base64_data?.trim();
    const imageMimeType = body.image_mime_type?.trim();
    if (!imageBase64Data || !imageMimeType) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message:
              "Use phase \"sign\" / \"complete\" for direct uploads, or send image_base64_data and image_mime_type.",
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
