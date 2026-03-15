import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { publishThreadMessageUpdated } from "@/app/lib/sync";

type ThreadEditBody = {
  thread_id?: string;
  message_id?: string;
  text?: string;
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("thread_edit_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ThreadEditBody;
    const threadId = body.thread_id?.trim();
    const messageId = body.message_id?.trim();
    const text = body.text?.trim();

    if (!threadId || !messageId || !text) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "thread_id, message_id, and text are required." } },
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
        owner: true,
        user_thread_access: {
          select: {
            user_id: true,
          },
        },
      },
    });

    if (!thread) {
      return NextResponse.json(
        { error: { code: "thread_not_found", message: "Thread not found or inaccessible." } },
        { status: 404 },
      );
    }

    const message = await prisma.thread_messages.findFirst({
      where: {
        id: messageId,
        created_by: authResult.user_id,
      },
      select: {
        id: true,
        parent_id: true,
      },
    });

    if (!message) {
      return NextResponse.json(
        { error: { code: "forbidden", message: "Only the sender can edit this message." } },
        { status: 403 },
      );
    }

    // Ensure message belongs to thread.
    let currentParentId = message.parent_id;
    let isInThread = message.parent_id === thread.id;
    let safety = 0;
    while (!isInThread && currentParentId && safety < 100) {
      const parentMessage = await prisma.thread_messages.findFirst({
        where: { id: currentParentId },
        select: { parent_id: true },
      });
      if (!parentMessage) {
        break;
      }

      if (parentMessage.parent_id === thread.id) {
        isInThread = true;
        break;
      }

      currentParentId = parentMessage.parent_id;
      safety += 1;
    }

    if (!isInThread) {
      return NextResponse.json(
        { error: { code: "invalid_message", message: "Message is not in this thread." } },
        { status: 400 },
      );
    }

    const updatedMessage = await prisma.thread_messages.update({
      where: {
        id: message.id,
      },
      data: {
        text,
        updated_at: new Date(),
      },
      select: {
        id: true,
        text: true,
        created_at: true,
        created_by: true,
        parent_id: true,
        users: {
          select: {
            username: true,
          },
        },
      },
    });

    const threadMemberUserIds = Array.from(
      new Set([
        thread.owner,
        ...thread.user_thread_access.map((accessRow) => accessRow.user_id),
      ]),
    );
    publishThreadMessageUpdated(threadMemberUserIds, {
      thread_id: thread.id,
      message_id: updatedMessage.id,
      created_by: updatedMessage.created_by,
    });

    return NextResponse.json(
      {
        message: {
          id: updatedMessage.id,
          text: updatedMessage.text ?? "",
          created_at: updatedMessage.created_at,
          created_by: updatedMessage.created_by,
          parent_id: updatedMessage.parent_id,
          username: updatedMessage.users.username,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("thread_edit_failed", error);
    return NextResponse.json(
      { error: { code: "thread_edit_failed", message: "Failed to edit message." } },
      { status: 500 },
    );
  }
}
