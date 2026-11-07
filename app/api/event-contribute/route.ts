import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { sanitizeNotificationText } from "@/app/lib/notification_text";
import { sendPushToUsers } from "@/app/lib/push_notifications";
import {
  appendSharedPostMedia,
  asEventSharedPostData,
  canContributeToEventAlbum,
  countContributorMedia,
  parseSharedPostMediaItems,
} from "@/app/lib/sharedPosts";
import { findThreadEventForMember } from "@/app/lib/threadEvents";
import type { EventContributeRequest, EventContributeResponse } from "@/app/types/interfaces";

class ContributeFailureError extends Error {
  status: number;
  payload: { error: { code: string; message: string } };

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.payload = { error: { code, message } };
  }
}

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("event_contribute_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as EventContributeRequest;
    const eventId = body.event_id?.trim() ?? "";
    const parsedMedia = parseSharedPostMediaItems(body.media);
    if (!eventId) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "event_id is required." } },
        { status: 400 },
      );
    }
    if (!parsedMedia) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_media",
            message: "media must be a non-empty list of items with owner_user_id.",
          },
        },
        { status: 400 },
      );
    }

    const existing = await findThreadEventForMember(eventId, authResult.user_id);
    if (!existing) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Event not found or inaccessible." } },
        { status: 404 },
      );
    }
    if (!canContributeToEventAlbum(existing)) {
      return NextResponse.json(
        {
          error: {
            code: "closed",
            message: "Contributions are only allowed before the close date.",
          },
        },
        { status: 400 },
      );
    }

    const contributedCount = await prisma.$transaction(async (tx) => {
      const lockedRows = await tx.$queryRaw<
        Array<{
          id: string;
          shared_post_data: Prisma.JsonValue | null;
          blind_reveal: boolean;
          close_at: Date | null;
          release_at: Date | null;
        }>
      >`
        SELECT id, shared_post_data, blind_reveal, close_at, release_at
        FROM thread_events
        WHERE id = ${existing.id}::uuid
        FOR UPDATE
      `;
      const locked = lockedRows[0];
      if (!locked) {
        throw new ContributeFailureError(404, "not_found", "Event not found or inaccessible.");
      }
      if (!canContributeToEventAlbum(locked)) {
        throw new ContributeFailureError(
          400,
          "closed",
          "Contributions are only allowed before the close date.",
        );
      }

      const appended = appendSharedPostMedia({
        existingData: asEventSharedPostData(locked.shared_post_data),
        newMedia: parsedMedia,
        contributorUserId: authResult.user_id,
      });
      if (!appended.ok) {
        throw new ContributeFailureError(400, appended.code, appended.message);
      }

      await tx.thread_events.update({
        where: { id: locked.id },
        data: {
          shared_post_data: appended.data as Prisma.InputJsonValue,
          updated_at: new Date(),
        },
      });

      return countContributorMedia(appended.data.media ?? [], authResult.user_id);
    });

    const thread = existing.threads_thread_events_thread_idTothreads;
    const recipientUserIds = Array.from(
      new Set([thread.owner, ...thread.user_thread_access.map((access) => access.user_id)]),
    ).filter((userId) => userId !== authResult.user_id);
    if (recipientUserIds.length > 0) {
      const eventTitle = sanitizeNotificationText(existing.name) || "an event";
      const mediaCount = parsedMedia.length;
      const allVideos = parsedMedia.every((item) => item.kind === "video");
      const mediaLabel =
        mediaCount === 1
          ? allVideos
            ? "a video"
            : "a photo"
          : allVideos
            ? `${mediaCount} videos`
            : `${mediaCount} photos`;
      void sendPushToUsers({
        recipientUserIds,
        payload: {
          title: eventTitle,
          body: `${authResult.username} added ${mediaLabel} to ${eventTitle}.`,
          url: "/?tab=events",
        },
      }).catch((error) => {
        console.error("event_contribute_push_dispatch_failed", error);
      });
    }

    const payload: EventContributeResponse = {
      ok: true,
      contributed_count: contributedCount,
    };
    // Never return media: blind events must not leak contributions.
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    if (error instanceof ContributeFailureError) {
      return NextResponse.json(error.payload, { status: error.status });
    }
    console.error("event_contribute_failed", error);
    return NextResponse.json(
      { error: { code: "event_contribute_failed", message: "Failed to contribute to event." } },
      { status: 500 },
    );
  }
}
