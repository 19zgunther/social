import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { finalizeThreadEventItem, findThreadAccessibleByUser } from "@/app/lib/threadEvents";
import type { ThreadEventsListRequest, ThreadEventsListResponse } from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("thread_events_list_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ThreadEventsListRequest;
    const threadId = body.thread_id?.trim();

    if (!threadId) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "thread_id is required." } },
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

    const now = new Date();
    const rows = await prisma.thread_events.findMany({
      where: {
        thread_id: thread.id,
        ends_at: { gt: now },
      },
      orderBy: { starts_at: "asc" },
    });

    const events = await Promise.all(rows.map((row) => finalizeThreadEventItem(row)));
    const payload: ThreadEventsListResponse = { events };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("thread_events_list_failed", error);
    return NextResponse.json(
      { error: { code: "thread_events_list_failed", message: "Failed to load thread events." } },
      { status: 500 },
    );
  }
}
