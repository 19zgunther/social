import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { createThreadBucketImageAccessGrant } from "@/app/api/image_access_grant";
import { uploadThreadImageToMainBucket } from "@/app/api/server_file_storage_utils";
import { ThreadImageSetResponse } from "@/app/types/interfaces";

type ThreadImageSetBody = {
  thread_id?: string;
  image_base64_data?: string;
  image_mime_type?: string;
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("thread_image_set_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ThreadImageSetBody;
    const threadId = body.thread_id?.trim();
    const imageBase64Data = body.image_base64_data?.trim();
    const imageMimeType = body.image_mime_type?.trim();

    if (!threadId || !imageBase64Data || !imageMimeType) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "thread_id, image_base64_data and image_mime_type are required.",
          },
        },
        { status: 400 },
      );
    }

    const thread = await prisma.threads.findFirst({
      where: {
        id: threadId,
        OR: [
          { owner: authResult.user_id },
          { user_thread_access: { some: { user_id: authResult.user_id } } },
        ],
      },
      select: {
        id: true,
      },
    });

    if (!thread) {
      return NextResponse.json(
        {
          error: {
            code: "thread_not_found",
            message: "Thread not found or you are not a member.",
          },
        },
        { status: 404 },
      );
    }

    const imageId = randomUUID();
    await uploadThreadImageToMainBucket({
      threadId,
      imageId,
      base64Data: imageBase64Data,
      mimeType: imageMimeType,
    });

    await prisma.threads.update({
      where: {
        id: thread.id,
      },
      data: {
        image_id: imageId,
      },
      select: {
        id: true,
      },
    });

    const image_access_grant = createThreadBucketImageAccessGrant({
      threadId,
      imageId,
      viewerUserId: authResult.user_id,
    });

    const payload: ThreadImageSetResponse = {
      thread_id: thread.id,
      image_id: imageId,
      image_url: null,
      image_access_grant,
    };

    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("thread_image_set_failed", error);
    return NextResponse.json(
      { error: { code: "thread_image_set_failed", message: "Failed to set thread image." } },
      { status: 500 },
    );
  }
}

