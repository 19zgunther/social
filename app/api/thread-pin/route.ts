import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";

const MAX_PINNED_THREADS = 12;

type ThreadPinBody = {
  thread_id?: string;
  pinned?: boolean;
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("thread_pin_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ThreadPinBody;
    const threadId = body.thread_id?.trim();
    const pinned = body.pinned === true;

    if (!threadId) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "thread_id is required." } },
        { status: 400 },
      );
    }

    if (typeof body.pinned !== "boolean") {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "pinned must be a boolean." } },
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

    if (pinned) {
      const pinnedCount = await prisma.user_thread_access.count({
        where: {
          user_id: authResult.user_id,
          user_pinned_thread: true,
          NOT: { thread_id: threadId },
        },
      });
      if (pinnedCount >= MAX_PINNED_THREADS) {
        return NextResponse.json(
          {
            error: {
              code: "pin_limit_reached",
              message: `You can pin at most ${MAX_PINNED_THREADS} chats.`,
            },
          },
          { status: 400 },
        );
      }
    }

    const existingAccess = await prisma.user_thread_access.findFirst({
      where: {
        thread_id: threadId,
        user_id: authResult.user_id,
      },
      select: { id: true },
    });

    if (existingAccess) {
      await prisma.user_thread_access.update({
        where: { id: existingAccess.id },
        data: { user_pinned_thread: pinned },
      });
    } else {
      await prisma.user_thread_access.create({
        data: {
          thread_id: threadId,
          user_id: authResult.user_id,
          created_at: new Date(),
          user_pinned_thread: pinned,
        },
      });
    }

    return NextResponse.json(
      { ok: true, thread_id: threadId, user_pinned_thread: pinned },
      { status: 200 },
    );
  } catch (error) {
    console.error("thread_pin_failed", error);
    return NextResponse.json(
      { error: { code: "thread_pin_failed", message: "Failed to update pin." } },
      { status: 500 },
    );
  }
}
