import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";

const getLatestMessageByThreadId = async (
  threadIds: string[],
  currentUserId: string,
): Promise<Map<string, Date>> => {
  const latestByThread = new Map<string, Date>();
  if (threadIds.length === 0) {
    return latestByThread;
  }

  const roots = await prisma.thread_messages.findMany({
    where: {
      parent_id: {
        in: threadIds,
      },
    },
    select: {
      id: true,
      parent_id: true,
      created_at: true,
      created_by: true,
    },
  });

  const messageThreadById = new Map<string, string>();
  let frontier: string[] = [];
  for (const root of roots) {
    if (!root.parent_id) {
      continue;
    }
    const threadId = root.parent_id;
    messageThreadById.set(root.id, threadId);
    frontier.push(root.id);
    if (root.created_by !== currentUserId) {
      const previous = latestByThread.get(threadId);
      if (!previous || previous < root.created_at) {
        latestByThread.set(threadId, root.created_at);
      }
    }
  }

  let safety = 0;
  while (frontier.length > 0 && safety < 100) {
    const children = await prisma.thread_messages.findMany({
      where: {
        parent_id: {
          in: frontier,
        },
      },
      select: {
        id: true,
        parent_id: true,
        created_at: true,
        created_by: true,
      },
    });

    if (children.length === 0) {
      break;
    }

    const nextFrontier: string[] = [];
    for (const child of children) {
      if (!child.parent_id) {
        continue;
      }
      const threadId = messageThreadById.get(child.parent_id);
      if (!threadId) {
        continue;
      }
      messageThreadById.set(child.id, threadId);
      nextFrontier.push(child.id);
      if (child.created_by !== currentUserId) {
        const previous = latestByThread.get(threadId);
        if (!previous || previous < child.created_at) {
          latestByThread.set(threadId, child.created_at);
        }
      }
    }

    frontier = nextFrontier;
    safety += 1;
  }

  return latestByThread;
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("groups_unread_count_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const threads = await prisma.threads.findMany({
      where: {
        OR: [
          { owner: authResult.user_id },
          { user_thread_access: { some: { user_id: authResult.user_id } } },
        ],
      },
      select: {
        id: true,
      },
    });
    const threadIds = threads.map((thread) => thread.id);

    if (threadIds.length === 0) {
      return NextResponse.json({ unread_threads_count: 0, unread_thread_ids: [] }, { status: 200 });
    }

    const lastReads = await prisma.user_thread_last_read_at.findMany({
      where: {
        user_id: authResult.user_id,
        thread_id: {
          in: threadIds,
        },
      },
      select: {
        thread_id: true,
        last_read_at: true,
      },
    });
    const lastReadByThreadId = new Map(lastReads.map((row) => [row.thread_id, row.last_read_at]));
    const latestByThreadId = await getLatestMessageByThreadId(threadIds, authResult.user_id);

    let unreadThreadsCount = 0;
    const unreadThreadIds: string[] = [];
    for (const threadId of threadIds) {
      const latest = latestByThreadId.get(threadId);
      if (!latest) {
        continue;
      }
      const lastRead = lastReadByThreadId.get(threadId);
      if (!lastRead || latest > lastRead) {
        unreadThreadsCount += 1;
        unreadThreadIds.push(threadId);
      }
    }

    return NextResponse.json(
      { unread_threads_count: unreadThreadsCount, unread_thread_ids: unreadThreadIds },
      { status: 200 },
    );
  } catch (error) {
    console.error("groups_unread_count_failed", error);
    return NextResponse.json(
      { error: { code: "groups_unread_count_failed", message: "Failed to compute unread threads." } },
      { status: 500 },
    );
  }
}
