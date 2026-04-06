import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { finalizeThreadEventItem, findThreadAccessibleByUser } from "@/app/lib/threadEvents";
import type { ThreadEventCreateRequest, ThreadEventCreateResponse } from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("thread_event_create_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ThreadEventCreateRequest;
    const threadId = body.thread_id?.trim();
    const name = body.name?.trim();
    const location = body.location?.trim() || null;
    const description = body.description?.trim() || null;
    const startsAtRaw = body.starts_at?.trim();
    const endsAtRaw = body.ends_at?.trim();

    if (!threadId) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "thread_id is required." } },
        { status: 400 },
      );
    }
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

    const thread = await findThreadAccessibleByUser(threadId, authResult.user_id);
    if (!thread) {
      return NextResponse.json(
        { error: { code: "thread_not_found", message: "Thread not found or inaccessible." } },
        { status: 404 },
      );
    }

    const createdAt = new Date();
    const row = await prisma.thread_events.create({
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

    const event = await finalizeThreadEventItem(row);
    const payload: ThreadEventCreateResponse = { event };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("thread_event_create_failed", error);
    return NextResponse.json(
      { error: { code: "thread_event_create_failed", message: "Failed to create thread event." } },
      { status: 500 },
    );
  }
}
