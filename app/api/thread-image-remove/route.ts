import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { ThreadImageRemoveResponse } from "@/app/types/interfaces";

type ThreadImageRemoveBody = {
  thread_id?: string;
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("thread_image_remove_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ThreadImageRemoveBody;
    const threadId = body.thread_id?.trim();

    if (!threadId) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "thread_id is required.",
          },
        },
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
      select: {
        id: true,
      },
    });

    if (!thread) {
      return NextResponse.json(
        {
          error: {
            code: "thread_not_found",
            message: "Thread not found or you are not a member.",
          },
        },
        { status: 404 },
      );
    }

    await prisma.threads.update({
      where: {
        id: thread.id,
      },
      data: {
        image_id: null,
      },
      select: {
        id: true,
      },
    });

    const payload: ThreadImageRemoveResponse = {
      thread_id: thread.id,
      image_id: null,
      image_url: null,
    };

    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("thread_image_remove_failed", error);
    return NextResponse.json(
      { error: { code: "thread_image_remove_failed", message: "Failed to remove thread image." } },
      { status: 500 },
    );
  }
}

