import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";

type ThreadMarkReadBody = {
  thread_id?: string;
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("thread_mark_read_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ThreadMarkReadBody;
    const threadId = body.thread_id?.trim();
    if (!threadId) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "thread_id is required." } },
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
      select: { id: true },
    });
    if (!thread) {
      return NextResponse.json(
        { error: { code: "thread_not_found", message: "Thread not found or inaccessible." } },
        { status: 404 },
      );
    }

    const now = new Date();
    const updated = await prisma.user_thread_last_read_at.updateMany({
      where: {
        thread_id: threadId,
        user_id: authResult.user_id,
      },
      data: {
        last_read_at: now,
      },
    });

    if (updated.count === 0) {
      await prisma.user_thread_last_read_at.create({
        data: {
          thread_id: threadId,
          user_id: authResult.user_id,
          last_read_at: now,
        },
      });
    }

    return NextResponse.json({ ok: true, thread_id: threadId, last_read_at: now }, { status: 200 });
  } catch (error) {
    console.error("thread_mark_read_failed", error);
    return NextResponse.json(
      { error: { code: "thread_mark_read_failed", message: "Failed to mark thread as read." } },
      { status: 500 },
    );
  }
}
