import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import {
  finalizeThreadEventItem,
  findThreadAccessibleByUser,
  userCanAdminThreadEvent,
} from "@/app/lib/threadEvents";
import type { ThreadEventUpdateRequest, ThreadEventUpdateResponse } from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("thread_event_update_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ThreadEventUpdateRequest;
    const threadId = body.thread_id?.trim();
    const eventId = body.event_id?.trim();
    const name = body.name?.trim();
    const location =
      body.location === undefined || body.location === null
        ? null
        : body.location.trim() || null;
    const description =
      body.description === undefined || body.description === null
        ? null
        : body.description.trim() || null;
    const startsAtRaw = body.starts_at?.trim();
    const endsAtRaw = body.ends_at?.trim();

    if (!threadId || !eventId) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "thread_id and event_id are required." } },
        { status: 400 },
      );
    }
    if (!name) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "name is required." } },
        { status: 400 },
      );
    }
    if (!startsAtRaw || !endsAtRaw) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "starts_at and ends_at are required." } },
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
            message: "Only the event creator or thread owner can edit this event.",
          },
        },
        { status: 403 },
      );
    }

    const row = await prisma.thread_events.update({
      where: { id: existing.id },
      data: {
        name,
        location,
        description,
        starts_at: startsAt,
        ends_at: endsAt,
        updated_at: new Date(),
      },
    });

    const event = await finalizeThreadEventItem(row, authResult.user_id);
    const payload: ThreadEventUpdateResponse = { event };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("thread_event_update_failed", error);
    return NextResponse.json(
      { error: { code: "thread_event_update_failed", message: "Failed to update thread event." } },
      { status: 500 },
    );
  }
}
