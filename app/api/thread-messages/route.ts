import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import {
  createMainBucketImageAccessGrant,
  createThreadBucketImageAccessGrant,
} from "@/app/api/image_access_grant";
import { prisma } from "@/app/lib/prisma";
import { MessageData, ThreadMessagesRequest, ThreadMessagesResponse } from "@/app/types/interfaces";

const PAGE_SIZE = 100;

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("thread_messages_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ThreadMessagesRequest;
    const threadId = body.thread_id?.trim();
    const cursorMessageId = body.cursor_message_id?.trim();

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
      select: {
        id: true,
        name: true,
        owner: true,
        image_id: true,
      },
    });

    if (!thread) {
      return NextResponse.json(
        { error: { code: "thread_not_found", message: "Thread not found or inaccessible." } },
        { status: 404 },
      );
    }

    const rootMessagesDesc = await prisma.thread_messages.findMany({
      where: {
        parent_id: thread.id,
      },
      ...(cursorMessageId
        ? {
            cursor: {
              id: cursorMessageId,
            },
            skip: 1,
          }
        : {}),
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      take: PAGE_SIZE + 1,
      select: {
        id: true,
        text: true,
        created_at: true,
        created_by: true,
        parent_id: true,
        image_id: true,
        data: true,
        users: {
          select: {
            username: true,
          },
        },
      },
    });
    const hasMoreOlder = rootMessagesDesc.length > PAGE_SIZE;
    const pagedRootMessages = rootMessagesDesc.slice(0, PAGE_SIZE).reverse();

    const allMessages = [...pagedRootMessages];
    let frontier = pagedRootMessages.map((message) => message.id);
    let safety = 0;
    while (frontier.length > 0 && safety < 100) {
      const children = await prisma.thread_messages.findMany({
        where: {
          parent_id: {
            in: frontier,
          },
        },
        orderBy: [{ created_at: "asc" }, { id: "asc" }],
        select: {
          id: true,
          text: true,
          created_at: true,
          created_by: true,
          parent_id: true,
          image_id: true,
          data: true,
          users: {
            select: {
              username: true,
            },
          },
        },
      });

      if (children.length === 0) {
        break;
      }

      allMessages.push(...children);
      frontier = children.map((message) => message.id);
      safety += 1;
    }

    const directReplyCountByParentId = new Map<string, number>();
    for (const message of allMessages) {
      if (!message.parent_id || message.parent_id === thread.id) {
        continue;
      }

      directReplyCountByParentId.set(
        message.parent_id,
        (directReplyCountByParentId.get(message.parent_id) ?? 0) + 1,
      );
    }

    let threadImageAccessGrant: string | null = null;
    if (thread.image_id) {
      try {
        threadImageAccessGrant = createThreadBucketImageAccessGrant({
          imageId: thread.image_id,
          threadId: thread.id,
          viewerUserId: authResult.user_id,
        });
      } catch (error) {
        console.error("thread_image_grant_failed", thread.id, error);
      }
    }

    const messageGrantEntries = allMessages.map((message) => {
      if (!message.image_id) {
        return [message.id, null] as const;
      }
      try {
        const grant = createMainBucketImageAccessGrant({
          imageId: message.image_id,
          storageUserId: message.created_by,
          viewerUserId: authResult.user_id,
        });
        return [message.id, grant] as const;
      } catch (error) {
        console.error("thread_message_image_grant_failed", message.id, error);
        return [message.id, null] as const;
      }
    });
    const imageAccessGrantByMessageId = new Map(messageGrantEntries);

    const payload: ThreadMessagesResponse = {
      thread: {
        id: thread.id,
        name: thread.name,
        owner_user_id: thread.owner,
        image_id: thread.image_id ?? null,
        image_url: null,
        image_access_grant: threadImageAccessGrant,
      },
      viewer_user_id: authResult.user_id,
      has_more_older: hasMoreOlder,
      next_cursor_message_id: pagedRootMessages.length > 0 ? pagedRootMessages[0].id : null,
      messages: allMessages.map((message) => ({
        id: message.id,
        text: message.text ?? "",
        created_at: message.created_at.toISOString(),
        created_by: message.created_by,
        parent_id: message.parent_id,
        image_id: message.image_id,
        image_url: null,
        image_access_grant: imageAccessGrantByMessageId.get(message.id) ?? null,
        data: message.data as MessageData | null,
        direct_reply_count: directReplyCountByParentId.get(message.id) ?? 0,
        username: message.users.username,
      })),
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("thread_messages_failed", error);
    return NextResponse.json(
      { error: { code: "thread_messages_failed", message: "Failed to load thread messages." } },
      { status: 500 },
    );
  }
}
