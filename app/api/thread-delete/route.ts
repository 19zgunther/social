import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";

type ThreadDeleteBody = {
  thread_id?: string;
};

async function collectMessageIdsInThread(threadId: string): Promise<string[]> {
  const roots = await prisma.thread_messages.findMany({
    where: { parent_id: threadId },
    select: { id: true },
  });

  const ids = new Set<string>();
  const frontier: string[] = [];

  for (const root of roots) {
    ids.add(root.id);
    frontier.push(root.id);
  }

  let safety = 0;
  while (frontier.length > 0 && safety < 500) {
    const children = await prisma.thread_messages.findMany({
      where: { parent_id: { in: frontier } },
      select: { id: true },
    });
    frontier.length = 0;
    for (const child of children) {
      if (!ids.has(child.id)) {
        ids.add(child.id);
        frontier.push(child.id);
      }
    }
    safety += 1;
  }

  return [...ids];
}

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("thread_delete_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ThreadDeleteBody;
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
        owner: authResult.user_id,
      },
      select: { id: true },
    });

    if (!thread) {
      return NextResponse.json(
        {
          error: {
            code: "forbidden",
            message: "Only the group owner can delete this thread.",
          },
        },
        { status: 403 },
      );
    }

    const messageIds = await collectMessageIdsInThread(threadId);

    await prisma.$transaction(async (tx) => {
      if (messageIds.length > 0) {
        await tx.thread_messages.deleteMany({
          where: { id: { in: messageIds } },
        });
      }

      await tx.webrtc_signalling.deleteMany({
        where: { thread_id: threadId },
      });

      await tx.user_thread_access.deleteMany({
        where: { thread_id: threadId },
      });

      await tx.user_thread_last_read_at.deleteMany({
        where: { thread_id: threadId },
      });

      await tx.threads.delete({
        where: { id: threadId },
      });
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("thread_delete_failed", error);
    return NextResponse.json(
      { error: { code: "thread_delete_failed", message: "Failed to delete thread." } },
      { status: 500 },
    );
  }
}
