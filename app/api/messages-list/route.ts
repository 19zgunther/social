import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { createThreadBucketImageAccessGrant } from "@/app/api/image_access_grant";
import { resolveStorageBackends } from "@/app/lib/storageObjects";
import { isEmojiOnlyText, sanitizeNotificationText } from "@/app/lib/notification_text";
import { prisma } from "@/app/lib/prisma";
import { directPeerUsernameFromMembers } from "@/app/lib/threadDirect";
import { MessagesListResponse } from "@/app/types/interfaces";

type MessageRow = {
  id: string;
  parent_id: string | null;
  created_at: Date;
  text: string | null;
  image_id: string | null;
};

const LAST_MESSAGE_PREVIEW_MAX_CHARS = 160;

const buildLastMessagePreview = (latest: MessageRow | undefined): string | null => {
  if (!latest) {
    return null;
  }
  const rawText = latest.text?.trim() ?? "";
  if (rawText && isEmojiOnlyText(rawText)) {
    // Unicode emoji can show as-is; custom-emoji tokens sanitize to empty.
    return sanitizeNotificationText(rawText) || "Reacted";
  }
  const textPreview = sanitizeNotificationText(latest.text);
  if (textPreview) {
    if (textPreview.length <= LAST_MESSAGE_PREVIEW_MAX_CHARS) {
      return textPreview;
    }
    return `${textPreview.slice(0, LAST_MESSAGE_PREVIEW_MAX_CHARS).trimEnd()}…`;
  }
  if (latest.image_id) {
    return "Sent a photo";
  }
  return null;
};

async function loadLatestMessageByThreadId(
  threadIds: string[],
): Promise<Map<string, MessageRow>> {
  const latestByThread = new Map<string, MessageRow>();
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
      text: true,
      image_id: true,
    },
  });

  const messageToThread = new Map<string, string>();
  const all: MessageRow[] = [];

  for (const root of roots) {
    if (!root.parent_id) {
      continue;
    }
    messageToThread.set(root.id, root.parent_id);
    all.push(root);
  }

  let frontier = roots.map((row) => row.id);
  let safety = 0;

  while (frontier.length > 0 && safety < 200) {
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
        text: true,
        image_id: true,
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
      const threadId = messageToThread.get(child.parent_id);
      if (!threadId) {
        continue;
      }
      messageToThread.set(child.id, threadId);
      nextFrontier.push(child.id);
      all.push(child);
    }

    frontier = nextFrontier;
    safety += 1;
  }

  for (const message of all) {
    const threadId = messageToThread.get(message.id);
    if (!threadId) {
      continue;
    }
    const previous = latestByThread.get(threadId);
    if (!previous) {
      latestByThread.set(threadId, message);
      continue;
    }
    const prevTime = previous.created_at.getTime();
    const nextTime = message.created_at.getTime();
    if (nextTime > prevTime || (nextTime === prevTime && message.id > previous.id)) {
      latestByThread.set(threadId, message);
    }
  }

  return latestByThread;
}

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("messages_list_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const threads = await prisma.threads.findMany({
      where: {
        created_by_event: null,
        OR: [
          { owner: authResult.user_id },
          { user_thread_access: { some: { user_id: authResult.user_id } } },
        ],
      },
      orderBy: { created_at: "desc" },
      select: {
        id: true,
        name: true,
        owner: true,
        image_id: true,
        created_at: true,
        is_direct: true,
        users: {
          select: {
            username: true,
          },
        },
        user_thread_access: {
          select: {
            user_id: true,
            user_pinned_thread: true,
            users: {
              select: {
                username: true,
              },
            },
          },
        },
      },
    });

    const threadImageBackends = await resolveStorageBackends(threads.map((thread) => thread.image_id));
    const threadImageGrantEntries = threads.map((thread) => {
      if (!thread.image_id) {
        return [thread.id, null] as const;
      }
      try {
        const grant = createThreadBucketImageAccessGrant({
          imageId: thread.image_id,
          threadId: thread.id,
          viewerUserId: authResult.user_id,
          backend: threadImageBackends.get(thread.image_id) ?? "supabase",
        });
        return [thread.id, grant] as const;
      } catch (error) {
        console.error("messages_list_thread_image_grant_failed", thread.id, error);
        return [thread.id, null] as const;
      }
    });
    const imageAccessGrantByThreadId = new Map(threadImageGrantEntries);

    const threadIds = threads.map((thread) => thread.id);
    const latestByThreadId = await loadLatestMessageByThreadId(threadIds);

    const payload: MessagesListResponse = {
      threads: threads.map((thread) => {
        const latest = latestByThreadId.get(thread.id);
        const last_message_preview = buildLastMessagePreview(latest);
        const memberUserIds = [
          ...new Set([
            thread.owner,
            ...thread.user_thread_access.map((access) => access.user_id),
          ]),
        ];
        const memberUsernames = [
          ...new Set(
            [
              thread.users.username,
              ...thread.user_thread_access.map((access) => access.users.username),
            ].filter((name) => Boolean(name?.trim())),
          ),
        ];
        const viewerAccess = thread.user_thread_access.find(
          (access) => access.user_id === authResult.user_id,
        );
        const user_pinned_thread = viewerAccess?.user_pinned_thread === true;
        const displayName =
          thread.is_direct === true
            ? directPeerUsernameFromMembers(thread, authResult.user_id) ?? thread.name
            : thread.name;

        return {
          id: thread.id,
          name: displayName,
          created_at: thread.created_at.toISOString(),
          owner_user_id: thread.owner,
          owner_username: thread.users.username,
          is_direct: thread.is_direct === true,
          member_user_ids: memberUserIds,
          member_usernames: memberUsernames,
          user_pinned_thread,
          image_id: thread.image_id,
          image_url: null,
          image_access_grant: imageAccessGrantByThreadId.get(thread.id) ?? null,
          last_message_preview,
        };
      }),
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("messages_list_failed", error);
    return NextResponse.json(
      { error: { code: "messages_list_failed", message: "Failed to load messages." } },
      { status: 500 },
    );
  }
}
