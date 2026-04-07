import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import {
  createMainBucketImageAccessGrant,
  createThreadBucketImageAccessGrant,
} from "@/app/api/image_access_grant";
import { prisma } from "@/app/lib/prisma";
import {
  GroupsListResponse,
  ImageOverlayData,
  ThreadItem,
} from "@/app/types/interfaces";

type MessageRow = {
  id: string;
  parent_id: string | null;
  created_at: Date;
  created_by: string;
  text: string | null;
  image_id: string | null;
  data: unknown;
};

const clampOverlayYRatio = (value: number): number => {
  if (Number.isNaN(value)) {
    return 0.5;
  }
  return Math.min(0.9, Math.max(0.1, value));
};

const parseImageOverlayFromMessageData = (data: unknown): ImageOverlayData | null => {
  if (!data || typeof data !== "object") {
    return null;
  }
  const record = data as Record<string, unknown>;
  const overlay = record.image_overlay;
  if (!overlay || typeof overlay !== "object") {
    return null;
  }
  const o = overlay as Record<string, unknown>;
  if (typeof o.text !== "string" || typeof o.y_ratio !== "number") {
    return null;
  }
  const trimmedText = o.text.trim();
  if (!trimmedText) {
    return null;
  }
  return {
    text: trimmedText,
    y_ratio: clampOverlayYRatio(o.y_ratio),
  };
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
      created_by: true,
      text: true,
      image_id: true,
      data: true,
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
        created_by: true,
        text: true,
        image_id: true,
        data: true,
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
    console.error("groups_list_auth_failed", authResult.error);
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
      orderBy: { created_at: "desc" },
      select: {
        id: true,
        name: true,
        owner: true,
        image_id: true,
        created_at: true,
        users: {
          select: {
            username: true,
          },
        },
        user_thread_access: {
          select: {
            user_id: true,
          },
        },
      },
    });

    const threadImageGrantEntries = threads.map((thread) => {
      if (!thread.image_id) {
        return [thread.id, null] as const;
      }
      try {
        const grant = createThreadBucketImageAccessGrant({
          imageId: thread.image_id,
          threadId: thread.id,
          viewerUserId: authResult.user_id,
        });
        return [thread.id, grant] as const;
      } catch (error) {
        console.error("groups_list_thread_image_grant_failed", thread.id, error);
        return [thread.id, null] as const;
      }
    });
    const imageAccessGrantByThreadId = new Map(threadImageGrantEntries);

    const threadIds = threads.map((thread) => thread.id);
    const latestByThreadId = await loadLatestMessageByThreadId(threadIds);

    const payload: GroupsListResponse = {
      threads: threads.map((thread) => {
        const latest = latestByThreadId.get(thread.id);
        const last_message_at = latest ? latest.created_at.toISOString() : null;
        const last_message_from_self = Boolean(
          latest && latest.created_by === authResult.user_id,
        );

        let last_photo_preview: ThreadItem["last_photo_preview"] = null;
        const participantCount = new Set([
          thread.owner,
          ...thread.user_thread_access.map((access) => access.user_id),
        ]).size;
        if (latest && latest.created_by !== authResult.user_id) {
          if (latest.image_id) {
            try {
              const previewGrant = createMainBucketImageAccessGrant({
                imageId: latest.image_id,
                storageUserId: latest.created_by,
                viewerUserId: authResult.user_id,
              });
              const overlay = parseImageOverlayFromMessageData(latest.data);
              last_photo_preview = {
                message_id: latest.id,
                image_id: latest.image_id,
                image_url: null,
                image_access_grant: previewGrant,
                image_storage_user_id: latest.created_by,
                image_overlay: overlay,
              };
            } catch (error) {
              console.error("groups_list_last_photo_grant_failed", thread.id, error);
            }
          } else if (latest.text?.trim()) {
            last_photo_preview = {
              message_id: latest.id,
              image_id: null,
              image_url: null,
              image_overlay: null,
            };
          }
        }

        return {
          id: thread.id,
          name: thread.name,
          created_at: thread.created_at.toISOString(),
          owner_user_id: thread.owner,
          owner_username: thread.users.username,
          participant_count: participantCount,
          image_id: thread.image_id,
          image_url: null,
          image_access_grant: imageAccessGrantByThreadId.get(thread.id) ?? null,
          last_message_at,
          last_message_from_self,
          last_photo_preview,
        };
      }),
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("groups_list_failed", error);
    return NextResponse.json(
      { error: { code: "groups_list_failed", message: "Failed to load groups." } },
      { status: 500 },
    );
  }
}
