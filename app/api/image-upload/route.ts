import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { authCheck } from "@/app/api/auth_utils";
import {
  createSignedMainBucketUploadUrl,
  getSignedMainBucketImageUrl,
  mainBucketUserObjectExists,
  uploadImageToMainBucket,
} from "@/app/api/server_file_storage_utils";
import { registerStorageObject } from "@/app/lib/storageObjects";
import type {
  ImageUploadCompleteRequest,
  ImageUploadRequest,
  ImageUploadResponse,
  ImageUploadSignRequest,
  ImageUploadSignResponse,
} from "@/app/types/interfaces";
import { logErrorDump } from "@/app/lib/errorLog";
import { isAllowedVideoMimeType } from "@/app/lib/postMedia";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isSignRequest = (body: ImageUploadRequest): body is ImageUploadSignRequest =>
  "phase" in body && body.phase === "sign";

const isCompleteRequest = (body: ImageUploadRequest): body is ImageUploadCompleteRequest =>
  "phase" in body && body.phase === "complete";

const isAllowedUploadMimeType = (mimeType: string): boolean =>
  mimeType.startsWith("image/") || isAllowedVideoMimeType(mimeType);

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
      if (!isAllowedUploadMimeType(imageMimeType)) {
        return NextResponse.json(
          {
            error: {
              code: "invalid_request",
              message: "image_mime_type must be an image/* or allowed video MIME type.",
            },
          },
          { status: 400 },
        );
      }

      const imageId = randomUUID();
      const signed = await createSignedMainBucketUploadUrl({
        userId: authResult.user_id,
        imageId,
        mimeType: imageMimeType,
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

      // Bind complete to a real object under this caller's prefix so a random
      // UUID cannot poison the registry (missing row ⇒ Supabase) for others.
      const uploaded = await mainBucketUserObjectExists({
        userId: authResult.user_id,
        imageId,
      });
      if (!uploaded) {
        return NextResponse.json(
          {
            error: {
              code: "upload_incomplete",
              message: "No uploaded object found for this image_id.",
            },
          },
          { status: 400 },
        );
      }

      try {
        await registerStorageObject({
          id: imageId,
          backend: "s3",
          pathKind: "user",
          ownerId: authResult.user_id,
        });
      } catch (error) {
        if (error instanceof Error && error.message === "storage_object_conflict") {
          return NextResponse.json(
            {
              error: {
                code: "storage_object_conflict",
                message: "image_id is already registered to a different owner.",
              },
            },
            { status: 409 },
          );
        }
        throw error;
      }

      const imageUrl = await getSignedMainBucketImageUrl({
        userId: authResult.user_id,
        imageId,
        backend: "s3",
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
      backend: "s3",
    });

    const payload: ImageUploadResponse = {
      image_id: imageId,
      image_url: imageUrl,
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("image_upload_failed", error);
    void logErrorDump({
      userId: authResult.user_id,
      userName: authResult.username,
      key: "image_upload",
      error,
    });
    return NextResponse.json(
      { error: { code: "image_upload_failed", message: "Failed to upload image." } },
      { status: 500 },
    );
  }
}
