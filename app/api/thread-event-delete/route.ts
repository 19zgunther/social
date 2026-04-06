import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { findThreadAccessibleByUser } from "@/app/lib/threadEvents";
import type { ThreadEventDeleteRequest, ThreadEventDeleteResponse } from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("thread_event_delete_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ThreadEventDeleteRequest;
    const threadId = body.thread_id?.trim();
    const eventId = body.event_id?.trim();

    if (!threadId || !eventId) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "thread_id and event_id are required." } },
        { status: 400 },
      );
    }

    const thread = await prisma.threads.findFirst({
      where: {
        id: threadId,
        OR: [
          { owner: authResult.user_id },
          { user_thread_access: { some: { user_id: authResult.user_id } } },
        ],
      },
      select: { id: true, owner: true },
    });

    if (!thread) {
      return NextResponse.json(
        { error: { code: "thread_not_found", message: "Thread not found or inaccessible." } },
        { status: 404 },
      );
    }

    const event = await prisma.thread_events.findFirst({
      where: { id: eventId, thread_id: thread.id },
      select: { id: true, created_by: true },
    });

    if (!event) {
      return NextResponse.json(
        { error: { code: "event_not_found", message: "Event not found." } },
        { status: 404 },
      );
    }

    const isCreator = event.created_by === authResult.user_id;
    const isThreadOwner = thread.owner === authResult.user_id;
    if (!isCreator && !isThreadOwner) {
      return NextResponse.json(
        {
          error: {
            code: "forbidden",
            message: "Only the event creator or thread owner can delete this event.",
          },
        },
        { status: 403 },
      );
    }

    await prisma.thread_events.delete({
      where: { id: event.id },
    });

    const payload: ThreadEventDeleteResponse = { deleted_event_id: event.id };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("thread_event_delete_failed", error);
    return NextResponse.json(
      { error: { code: "thread_event_delete_failed", message: "Failed to delete thread event." } },
      { status: 500 },
    );
  }
}
