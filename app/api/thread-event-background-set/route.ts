import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { uploadThreadImageToMainBucket } from "@/app/api/server_file_storage_utils";
import {
  finalizeThreadEventItem,
  findThreadAccessibleByUser,
  userCanAdminThreadEvent,
} from "@/app/lib/threadEvents";
import type { ThreadEventBackgroundSetRequest, ThreadEventBackgroundSetResponse } from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("thread_event_background_set_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ThreadEventBackgroundSetRequest;
    const threadId = body.thread_id?.trim();
    const eventId = body.event_id?.trim();
    const imageBase64Data = body.image_base64_data?.trim();
    const imageMimeType = body.image_mime_type?.trim();

    if (!threadId || !eventId || !imageBase64Data || !imageMimeType) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "thread_id, event_id, image_base64_data and image_mime_type are required.",
          },
        },
        { status: 400 },
      );
    }

    const thread = await findThreadAccessibleByUser(threadId, authResult.user_id);
    if (!thread) {
      return NextResponse.json(
        { error: { code: "thread_not_found", message: "Thread not found or inaccessible." } },
        { status: 404 },
      );
    }

    const existing = await prisma.thread_events.findFirst({
      where: {
        id: eventId,
        thread_id: thread.id,
      },
    });

    if (!existing) {
      return NextResponse.json(
        { error: { code: "event_not_found", message: "Event not found." } },
        { status: 404 },
      );
    }

    if (
      !userCanAdminThreadEvent({
        userId: authResult.user_id,
        threadOwnerId: thread.owner,
        eventCreatedBy: existing.created_by,
      })
    ) {
      return NextResponse.json(
        {
          error: {
            code: "forbidden",
            message: "Only the event creator or thread owner can change the background.",
          },
        },
        { status: 403 },
      );
    }

    const imageId = randomUUID();
    await uploadThreadImageToMainBucket({
      threadId: thread.id,
      imageId,
      base64Data: imageBase64Data,
      mimeType: imageMimeType,
    });

    const row = await prisma.thread_events.update({
      where: { id: existing.id },
      data: { background_image_id: imageId, updated_at: new Date() },
    });

    const event = await finalizeThreadEventItem(row);
    const payload: ThreadEventBackgroundSetResponse = { event };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("thread_event_background_set_failed", error);
    return NextResponse.json(
      {
        error: {
          code: "thread_event_background_set_failed",
          message: "Failed to set event background image.",
        },
      },
      { status: 500 },
    );
  }
}
