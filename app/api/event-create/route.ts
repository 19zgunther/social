import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { authCheck } from "@/app/api/auth_utils";
import { uploadThreadImageToMainBucket } from "@/app/api/server_file_storage_utils";
import { prisma } from "@/app/lib/prisma";
import { loadAcceptedFriendIds } from "@/app/lib/acceptedFriendIds";
import { isDefaultEventImageKey, readDefaultEventImage } from "@/app/lib/defaultEventImages";
import { sanitizeNotificationText } from "@/app/lib/notification_text";
import { sendPushToUsers } from "@/app/lib/push_notifications";
import { validateSharedPostDates } from "@/app/lib/sharedPosts";
import { finalizeThreadEventItem } from "@/app/lib/threadEvents";
import { logErrorDump } from "@/app/lib/errorLog";
import type { EventCreateRequest, EventCreateResponse } from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("event_create_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as EventCreateRequest;
    const name = body.name?.trim();
    const location = body.location?.trim() || null;
    const description = body.description?.trim() || null;
    const startsAtRaw = body.starts_at?.trim();
    const endsAtRaw = body.ends_at?.trim();
    const defaultBackgroundKey = body.default_background_key?.trim() ?? "";
    const imageBase64Data = body.image_base64_data?.trim() ?? "";
    const imageMimeType = body.image_mime_type?.trim() ?? "";

    if (!name) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "name is required." } },
        { status: 400 },
      );
    }

    let backgroundBase64: string;
    let backgroundMime: string;
    if (defaultBackgroundKey) {
      if (!(await isDefaultEventImageKey(defaultBackgroundKey))) {
        return NextResponse.json(
          {
            error: {
              code: "invalid_default_background",
              message: "Unknown default background image.",
            },
          },
          { status: 400 },
        );
      }
      try {
        const loaded = await readDefaultEventImage(defaultBackgroundKey);
        backgroundBase64 = loaded.base64Data;
        backgroundMime = loaded.mimeType;
      } catch (error) {
        console.error("event_create_default_background_read_failed", error);
        return NextResponse.json(
          {
            error: {
              code: "default_background_unavailable",
              message: "Could not load the selected default background.",
            },
          },
          { status: 500 },
        );
      }
    } else if (imageBase64Data && imageMimeType) {
      if (!imageMimeType.startsWith("image/")) {
        return NextResponse.json(
          {
            error: {
              code: "invalid_request",
              message: "image_mime_type must be an image type.",
            },
          },
          { status: 400 },
        );
      }
      backgroundBase64 = imageBase64Data;
      backgroundMime = imageMimeType;
    } else {
      return NextResponse.json(
        {
          error: {
            code: "background_required",
            message: "A background image is required. Choose a default or upload your own.",
          },
        },
        { status: 400 },
      );
    }

    if (!startsAtRaw || !endsAtRaw) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "starts_at and ends_at are required.",
          },
        },
        { status: 400 },
      );
    }
    const startsAt = new Date(startsAtRaw);
    const endsAt = new Date(endsAtRaw);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "Invalid start or end time." } },
        { status: 400 },
      );
    }
    if (endsAt <= startsAt) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "ends_at must be after starts_at." } },
        { status: 400 },
      );
    }

    const blindReveal = body.blind_reveal === true;
    let closeAt: Date | null = null;
    let releaseAt: Date | null = null;
    if (blindReveal) {
      const closeAtRaw = body.close_at?.trim() ?? "";
      const releaseAtRaw = body.release_at?.trim() ?? "";
      if (!closeAtRaw || !releaseAtRaw) {
        return NextResponse.json(
          {
            error: {
              code: "invalid_dates",
              message: "close_at and release_at are required when blind_reveal is true.",
            },
          },
          { status: 400 },
        );
      }
      closeAt = new Date(closeAtRaw);
      releaseAt = new Date(releaseAtRaw);
      const datesOk = validateSharedPostDates(closeAt, releaseAt);
      if (!datesOk.ok) {
        return NextResponse.json(
          { error: { code: datesOk.code, message: datesOk.message } },
          { status: 400 },
        );
      }
    }

    const inviteeUserIds = Array.from(
      new Set((body.invitee_user_ids ?? []).map((id) => id.trim()).filter(Boolean)),
    ).filter((id) => id !== authResult.user_id);
    if (inviteeUserIds.length > 0) {
      const friendIds = await loadAcceptedFriendIds(authResult.user_id);
      if (inviteeUserIds.some((id) => !friendIds.has(id))) {
        return NextResponse.json(
          {
            error: {
              code: "invitees_not_friends",
              message: "You can only invite accepted friends.",
            },
          },
          { status: 400 },
        );
      }
      const existingUsers = await prisma.users.findMany({
        where: { id: { in: inviteeUserIds } },
        select: { id: true },
      });
      if (existingUsers.length !== inviteeUserIds.length) {
        return NextResponse.json(
          { error: { code: "invitee_not_found", message: "One or more invitees were not found." } },
          { status: 400 },
        );
      }
    }

    const createdAt = new Date();
    const backgroundImageId = randomUUID();

    const thread = await prisma.$transaction(async (tx) => {
      const createdThread = await tx.threads.create({
        data: {
          owner: authResult.user_id,
          name,
        },
        select: {
          id: true,
          name: true,
          owner: true,
          created_at: true,
        },
      });

      await tx.user_thread_access.create({
        data: {
          thread_id: createdThread.id,
          user_id: authResult.user_id,
          created_at: createdAt,
        },
      });

      if (inviteeUserIds.length > 0) {
        await tx.user_thread_access.createMany({
          data: inviteeUserIds.map((userId) => ({
            thread_id: createdThread.id,
            user_id: userId,
            created_at: createdAt,
          })),
        });
      }

      return createdThread;
    });

    try {
      await uploadThreadImageToMainBucket({
        threadId: thread.id,
        imageId: backgroundImageId,
        base64Data: backgroundBase64,
        mimeType: backgroundMime,
      });
    } catch (error) {
      console.error("event_create_background_upload_failed", error);
      await prisma.threads.delete({ where: { id: thread.id } }).catch((cleanupError) => {
        console.error("event_create_thread_cleanup_failed", cleanupError);
      });
      return NextResponse.json(
        {
          error: {
            code: "background_upload_failed",
            message: "Failed to upload event background image.",
          },
        },
        { status: 500 },
      );
    }

    const event = await prisma.$transaction(async (tx) => {
      const createdEvent = await tx.thread_events.create({
        data: {
          thread_id: thread.id,
          created_by: authResult.user_id,
          name,
          location,
          description,
          users_status_map: {},
          starts_at: startsAt,
          ends_at: endsAt,
          updated_at: createdAt,
          blind_reveal: blindReveal,
          close_at: closeAt,
          release_at: releaseAt,
          background_image_id: backgroundImageId,
        },
      });

      await tx.threads.update({
        where: { id: thread.id },
        data: { created_by_event: createdEvent.id },
      });

      return createdEvent;
    });

    if (inviteeUserIds.length > 0) {
      const eventTitle = sanitizeNotificationText(name) || "an event";
      try {
        await sendPushToUsers({
          recipientUserIds: inviteeUserIds,
          payload: {
            title: `Added to ${eventTitle}`,
            body: `${authResult.username} added you to ${eventTitle}.`,
            url: "/?tab=events",
            thread_id: thread.id,
          },
        });
      } catch (error) {
        console.error("event_create_push_dispatch_failed", error);
      }
    }

    const payload: EventCreateResponse = {
      thread: {
        id: thread.id,
        name: thread.name,
        created_at: thread.created_at.toISOString(),
        owner_user_id: thread.owner,
        owner_username: authResult.username,
        image_id: null,
        image_url: null,
      },
      event: await finalizeThreadEventItem(event, authResult.user_id),
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("event_create_failed", error);
    void logErrorDump({
      userId: authResult.user_id,
      userName: authResult.username,
      key: "event_create",
      error,
    });
    return NextResponse.json(
      { error: { code: "event_create_failed", message: "Failed to create event." } },
      { status: 500 },
    );
  }
}
