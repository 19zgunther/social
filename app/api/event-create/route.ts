import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { loadAcceptedFriendIds } from "@/app/lib/acceptedFriendIds";
import { sanitizeNotificationText } from "@/app/lib/notification_text";
import { sendPushToUsers } from "@/app/lib/push_notifications";
import { validateSharedPostDates } from "@/app/lib/sharedPosts";
import { finalizeThreadEventItem } from "@/app/lib/threadEvents";
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

    if (!name) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "name is required." } },
        { status: 400 },
      );
    }

    let startsAt: Date;
    let endsAt: Date;
    if (startsAtRaw && endsAtRaw) {
      startsAt = new Date(startsAtRaw);
      endsAt = new Date(endsAtRaw);
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
    } else {
      const now = new Date();
      startsAt = now;
      endsAt = new Date(now.getTime() + 60 * 60 * 1000);
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
    const created = await prisma.$transaction(async (tx) => {
      const thread = await tx.threads.create({
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
          thread_id: thread.id,
          user_id: authResult.user_id,
          created_at: createdAt,
        },
      });

      if (inviteeUserIds.length > 0) {
        await tx.user_thread_access.createMany({
          data: inviteeUserIds.map((userId) => ({
            thread_id: thread.id,
            user_id: userId,
            created_at: createdAt,
          })),
        });
      }

      const event = await tx.thread_events.create({
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
        },
      });

      await tx.threads.update({
        where: { id: thread.id },
        data: { created_by_event: event.id },
      });

      return { thread, event };
    });

    if (inviteeUserIds.length > 0) {
      const eventTitle = sanitizeNotificationText(name) || "an event";
      void sendPushToUsers({
        recipientUserIds: inviteeUserIds,
        payload: {
          title: `Added to ${eventTitle}`,
          body: `${authResult.username} added you to ${eventTitle}.`,
          url: "/?tab=events",
        },
      }).catch((error) => {
        console.error("event_create_push_dispatch_failed", error);
      });
    }

    const payload: EventCreateResponse = {
      thread: {
        id: created.thread.id,
        name: created.thread.name,
        created_at: created.thread.created_at.toISOString(),
        owner_user_id: created.thread.owner,
        owner_username: authResult.username,
        image_id: null,
        image_url: null,
      },
      event: await finalizeThreadEventItem(created.event, authResult.user_id),
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("event_create_failed", error);
    return NextResponse.json(
      { error: { code: "event_create_failed", message: "Failed to create event." } },
      { status: 500 },
    );
  }
}
