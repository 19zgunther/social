import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
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
        },
      });

      await tx.threads.update({
        where: { id: thread.id },
        data: { created_by_event: event.id },
      });

      return { thread, event };
    });

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
