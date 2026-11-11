import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { sanitizeNotificationText } from "@/app/lib/notification_text";
import { sendPushToUsers } from "@/app/lib/push_notifications";
import {
  eventHostRecipientUserIds,
  findThreadAccessibleByUser,
  isValidRsvpStatus,
  finalizeThreadEventItem,
  parseUsersStatusMap,
} from "@/app/lib/threadEvents";
import type {
  ThreadEventRsvpRequest,
  ThreadEventRsvpResponse,
  ThreadEventRsvpStatus,
} from "@/app/types/interfaces";

function rsvpStatusPhrase(status: ThreadEventRsvpStatus): string {
  if (status === "going") {
    return "can go";
  }
  if (status === "maybe") {
    return "might go";
  }
  return "cannot go";
}

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("thread_event_rsvp_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ThreadEventRsvpRequest;
    const threadId = body.thread_id?.trim();
    const eventId = body.event_id?.trim();
    const status = body.status;

    if (!threadId || !eventId) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "thread_id and event_id are required." } },
        { status: 400 },
      );
    }
    if (!isValidRsvpStatus(status)) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "status must be going, maybe, or not_going." } },
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
      where: { id: eventId, thread_id: thread.id },
      select: { id: true, users_status_map: true, created_by: true, name: true },
    });

    if (!existing) {
      return NextResponse.json(
        { error: { code: "event_not_found", message: "Event not found." } },
        { status: 404 },
      );
    }

    const previousMap = parseUsersStatusMap(existing.users_status_map);
    const previousStatus = previousMap[authResult.user_id];
    const statusChanged = previousStatus !== status;

    const nextMap = { ...previousMap };
    nextMap[authResult.user_id] = status;

    const row = await prisma.thread_events.update({
      where: { id: existing.id },
      data: { users_status_map: nextMap, updated_at: new Date() },
    });

    if (statusChanged) {
      const hostIds = await eventHostRecipientUserIds(existing.id, existing.created_by);
      const recipientUserIds = hostIds.filter((userId) => userId !== authResult.user_id);
      if (recipientUserIds.length > 0) {
        const eventTitle = sanitizeNotificationText(row.name) || "an event";
        const phrase = rsvpStatusPhrase(status);
        try {
          await sendPushToUsers({
            recipientUserIds,
            payload: {
              title: eventTitle,
              body: `${authResult.username} ${phrase} to ${eventTitle}.`,
              url: "/?tab=events",
              thread_id: thread.id,
            },
          });
        } catch (error) {
          console.error("thread_event_rsvp_push_dispatch_failed", error);
        }
      }
    }

    const event = await finalizeThreadEventItem(row, authResult.user_id);
    const payload: ThreadEventRsvpResponse = { event };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("thread_event_rsvp_failed", error);
    return NextResponse.json(
      { error: { code: "thread_event_rsvp_failed", message: "Failed to update RSVP." } },
      { status: 500 },
    );
  }
}
