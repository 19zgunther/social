import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { sanitizeNotificationText } from "@/app/lib/notification_text";
import { sendPushToUsers } from "@/app/lib/push_notifications";
import {
  THREAD_EVENT_ROLE_COHOST,
  finalizeThreadEventItem,
  findThreadAccessibleByUser,
  userCanAdminThreadEvent,
  userIsEventCohost,
} from "@/app/lib/threadEvents";
import type {
  ThreadEventCohostAddRequest,
  ThreadEventCohostAddResponse,
} from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("thread_event_cohost_add_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ThreadEventCohostAddRequest;
    const threadId = body.thread_id?.trim();
    const eventId = body.event_id?.trim();
    const targetUserId = body.user_id?.trim();

    if (!threadId || !eventId || !targetUserId) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "thread_id, event_id, and user_id are required.",
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
      where: { id: eventId, thread_id: thread.id },
    });
    if (!existing) {
      return NextResponse.json(
        { error: { code: "event_not_found", message: "Event not found." } },
        { status: 404 },
      );
    }

    const isCohost = await userIsEventCohost(existing.id, authResult.user_id);
    if (
      !userCanAdminThreadEvent({
        userId: authResult.user_id,
        threadOwnerId: thread.owner,
        eventCreatedBy: existing.created_by,
        isCohost,
      })
    ) {
      return NextResponse.json(
        {
          error: {
            code: "forbidden",
            message: "Only the event owner or a co-host can add co-hosts.",
          },
        },
        { status: 403 },
      );
    }

    if (targetUserId === authResult.user_id) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "You cannot add yourself as a co-host.",
          },
        },
        { status: 400 },
      );
    }

    if (targetUserId === existing.created_by) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "The event owner is already a host.",
          },
        },
        { status: 400 },
      );
    }

    const targetUser = await prisma.users.findFirst({
      where: { id: targetUserId },
      select: { id: true, username: true },
    });
    if (!targetUser) {
      return NextResponse.json(
        { error: { code: "user_not_found", message: "User not found." } },
        { status: 404 },
      );
    }

    const alreadyCohost = await userIsEventCohost(existing.id, targetUser.id);
    if (alreadyCohost) {
      const event = await finalizeThreadEventItem(existing, authResult.user_id);
      const payload: ThreadEventCohostAddResponse = { event };
      return NextResponse.json(payload, { status: 200 });
    }

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      const access = await tx.user_thread_access.findFirst({
        where: { thread_id: thread.id, user_id: targetUser.id },
        select: { id: true },
      });
      if (!access && targetUser.id !== thread.owner) {
        await tx.user_thread_access.create({
          data: {
            thread_id: thread.id,
            user_id: targetUser.id,
            created_at: now,
          },
        });
      }

      await tx.user_thread_event_role.create({
        data: {
          thread_event_id: existing.id,
          user_id: targetUser.id,
          role: THREAD_EVENT_ROLE_COHOST,
          created_at: now,
          created_by: authResult.user_id,
        },
      });
    });

    const eventTitle = sanitizeNotificationText(existing.name) || "an event";
    void sendPushToUsers({
      recipientUserIds: [targetUser.id],
      payload: {
        title: eventTitle,
        body: `${authResult.username} made you a co-host of ${eventTitle}.`,
        url: "/?tab=events",
        thread_id: thread.id,
      },
    }).catch((error) => {
      console.error("thread_event_cohost_add_push_failed", error);
    });

    const event = await finalizeThreadEventItem(existing, authResult.user_id);
    const payload: ThreadEventCohostAddResponse = { event };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("thread_event_cohost_add_failed", error);
    return NextResponse.json(
      {
        error: {
          code: "thread_event_cohost_add_failed",
          message: "Failed to add co-host.",
        },
      },
      { status: 500 },
    );
  }
}
