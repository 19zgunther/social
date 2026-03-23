import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import {
  getSignedMainBucketImageUrl,
  getSignedMainBucketThreadImageUrl,
} from "@/app/api/server_file_storage_utils";
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
      },
    });

    const imageUrlEntries = await Promise.all(
      threads.map(async (thread) => {
        if (!thread.image_id) {
          return [thread.id, null] as const;
        }

        try {
          const signedUrl = await getSignedMainBucketThreadImageUrl({
            threadId: thread.id,
            imageId: thread.image_id,
          });
          return [thread.id, signedUrl] as const;
        } catch (error) {
          console.error("groups_list_thread_image_sign_failed", thread.id, error);
          return [thread.id, null] as const;
        }
      }),
    );
    const imageUrlByThreadId = new Map(imageUrlEntries);

    const threadIds = threads.map((thread) => thread.id);
    const latestByThreadId = await loadLatestMessageByThreadId(threadIds);

    const payload: GroupsListResponse = {
      threads: await Promise.all(
        threads.map(async (thread) => {
          const latest = latestByThreadId.get(thread.id);
          const last_message_at = latest ? latest.created_at.toISOString() : null;

          let last_photo_preview: ThreadItem["last_photo_preview"] = null;
          if (
            latest &&
            latest.image_id &&
            latest.created_by !== authResult.user_id
          ) {
            try {
              const signedUrl = await getSignedMainBucketImageUrl({
                userId: latest.created_by,
                imageId: latest.image_id,
              });
              const overlay = parseImageOverlayFromMessageData(latest.data);
              last_photo_preview = {
                message_id: latest.id,
                image_id: latest.image_id,
                image_url: signedUrl,
                image_overlay: overlay,
              };
            } catch (error) {
              console.error("groups_list_last_photo_sign_failed", thread.id, error);
            }
          }

          return {
            id: thread.id,
            name: thread.name,
            created_at: thread.created_at.toISOString(),
            owner_user_id: thread.owner,
            owner_username: thread.users.username,
            image_id: thread.image_id,
            image_url: imageUrlByThreadId.get(thread.id) ?? null,
            last_message_at,
            last_photo_preview,
          };
        }),
      ),
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
