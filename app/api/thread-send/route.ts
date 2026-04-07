import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { publishThreadMessagePosted } from "@/app/lib/sync";
import { sendPushToUsers } from "@/app/lib/push_notifications";
import { createMainBucketImageAccessGrant } from "@/app/api/image_access_grant";
import { uploadImageToMainBucket } from "@/app/api/server_file_storage_utils";
import {
  MessageData,
  PoolBallState,
  PoolGameMessageData,
  ThreadSendRequest,
  ThreadSendResponse,
} from "@/app/types/interfaces";

type RawMessageData = {
  image_overlay?: {
    text?: unknown;
    y_ratio?: unknown;
  };
  // Allow additional structured fields like video_call_signal without stripping them.
  video_call_signal?: unknown;
  pool_game?: unknown;
};

const USERNAME_POOL_FIELD_MAX = 80;
const POOL_GAME_ID_MAX = 64;

const clampNumber = (value: unknown, min: number, max: number, fallback: number): number => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
};

const sanitizeUsernameField = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > USERNAME_POOL_FIELD_MAX) {
    return null;
  }
  return trimmed;
};

const sanitizePoolBall = (raw: unknown, tableW: number, tableH: number): PoolBallState | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "number" && Number.isInteger(o.id) ? o.id : -1;
  if (id < 0 || id > 15) {
    return null;
  }
  const r = clampNumber(o.r, 0.01, 0.2, 0.055);
  const margin = r * 2;
  const x = clampNumber(o.x, -margin, tableW + margin, tableW / 2);
  const y = clampNumber(o.y, -margin, tableH + margin, tableH / 2);
  const vx = clampNumber(o.vx, -80, 80, 0);
  const vy = clampNumber(o.vy, -80, 80, 0);
  const pocketed = o.pocketed === true;
  return { id, x, y, vx, vy, r, pocketed };
};

const sanitizePoolGameMessage = (raw: unknown): PoolGameMessageData | undefined => {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) {
    return undefined;
  }
  const gameId =
    typeof o.game_id === "string" && o.game_id.trim().length > 0 && o.game_id.length <= POOL_GAME_ID_MAX
      ? o.game_id.trim()
      : null;
  if (!gameId) {
    return undefined;
  }

  const playerA = sanitizeUsernameField(o.player_a_username);
  if (!playerA) {
    return undefined;
  }

  let playerB: string | null = null;
  const rawB = o.player_b_username;
  if (rawB !== null && rawB !== undefined && rawB !== "") {
    const b = sanitizeUsernameField(rawB);
    if (!b) {
      return undefined;
    }
    if (b === playerA) {
      return undefined;
    }
    playerB = b;
  }

  let currentTurn: string | null = null;
  const rawTurn = o.current_turn_username;
  if (rawTurn !== null && rawTurn !== undefined && rawTurn !== "") {
    const t = sanitizeUsernameField(rawTurn);
    if (!t) {
      return undefined;
    }
    currentTurn = t;
  }

  if (playerB === null) {
    if (currentTurn !== null && currentTurn !== playerA) {
      return undefined;
    }
  } else if (currentTurn !== null && currentTurn !== playerA && currentTurn !== playerB) {
    return undefined;
  }

  const tableW = clampNumber(o.table_w, 2, 12, 4);
  const tableH = clampNumber(o.table_h, 1, 8, 2);

  if (!Array.isArray(o.balls) || o.balls.length === 0 || o.balls.length > 16) {
    return undefined;
  }

  const balls: PoolBallState[] = [];
  for (const ballRaw of o.balls) {
    const ball = sanitizePoolBall(ballRaw, tableW, tableH);
    if (!ball) {
      return undefined;
    }
    balls.push(ball);
  }

  const seenIds = new Set<number>();
  for (const ball of balls) {
    if (seenIds.has(ball.id)) {
      return undefined;
    }
    seenIds.add(ball.id);
  }
  if (!seenIds.has(0)) {
    return undefined;
  }

  return {
    v: 1,
    game_id: gameId,
    player_a_username: playerA,
    player_b_username: playerB,
    current_turn_username: currentTurn,
    table_w: tableW,
    table_h: tableH,
    balls,
  } satisfies PoolGameMessageData;
};

const clampOverlayYRatio = (value: number): number => Math.min(0.9, Math.max(0.1, value));

const sanitizeMessageData = (rawData: unknown): Prisma.InputJsonValue | undefined => {
  if (!rawData || typeof rawData !== "object") {
    return undefined;
  }

  const parsedData = rawData as RawMessageData;
  const result: Record<string, unknown> = {};

  const overlay = parsedData.image_overlay;
  if (overlay && typeof overlay === "object") {
    if (typeof overlay.text === "string" && typeof overlay.y_ratio === "number") {
      const trimmedText = overlay.text.trim();
      if (trimmedText) {
        result.image_overlay = {
          text: trimmedText,
          y_ratio: clampOverlayYRatio(overlay.y_ratio),
        };
      }
    }
  }

  // Pass through video_call_signal (and potentially other structured fields) without modification.
  if (parsedData.video_call_signal !== undefined) {
    result.video_call_signal = parsedData.video_call_signal;
  }

  const poolGame = sanitizePoolGameMessage(parsedData.pool_game);
  if (poolGame) {
    result.pool_game = poolGame;
  }

  if (Object.keys(result).length === 0) {
    return undefined;
  }

  return result as Prisma.InputJsonValue;
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("thread_send_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ThreadSendRequest;
    const threadId = body.thread_id?.trim();
    const text = body.text?.trim();
    const replyToMessageId = body.reply_to_message_id?.trim();
    const imageBase64Data = body.image_base64_data?.trim();
    const imageMimeType = body.image_mime_type?.trim();
    const messageData = sanitizeMessageData(body.message_data);

    if (!threadId || (!text && !imageBase64Data && !messageData)) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "thread_id and at least one of text, image, or message_data are required.",
          },
        },
        { status: 400 },
      );
    }

    if (imageBase64Data && !imageMimeType) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "image_mime_type is required with image." } },
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

    let parentMessageId = thread.id;
    if (replyToMessageId) {
      const replyTarget = await prisma.thread_messages.findFirst({
        where: {
          id: replyToMessageId,
        },
        select: {
          id: true,
          parent_id: true,
        },
      });

      if (!replyTarget) {
        return NextResponse.json(
          { error: { code: "reply_target_not_found", message: "Reply target not found." } },
          { status: 404 },
        );
      }

      // Walk parents to ensure target belongs to this thread.
      let currentParentId = replyTarget.parent_id;
      let safety = 0;
      let isInThread = replyTarget.parent_id === thread.id;
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
          { error: { code: "reply_target_invalid", message: "Reply target is not in this thread." } },
          { status: 400 },
        );
      }

      parentMessageId = replyToMessageId;
    }

    const imageId = imageBase64Data ? randomUUID() : null;
    if (imageId && imageBase64Data && imageMimeType) {
      await uploadImageToMainBucket({
        userId: authResult.user_id,
        imageId,
        base64Data: imageBase64Data,
        mimeType: imageMimeType,
      });
    }

    const message = await prisma.thread_messages.create({
      data: {
        created_by: authResult.user_id,
        parent_id: parentMessageId,
        text: text ?? null,
        image_id: imageId,
        ...(messageData ? { data: messageData } : {}),
      },
      select: {
        id: true,
        text: true,
        created_at: true,
        created_by: true,
        parent_id: true,
        image_id: true,
        data: true,
      },
    });
    const messageAuthor = await prisma.users.findFirst({
      where: {
        id: message.created_by,
      },
      select: {
        username: true,
      },
    });

    const threadMemberUserIds = Array.from(
      new Set([
        thread.owner,
        ...thread.user_thread_access.map((accessRow) => accessRow.user_id),
      ]),
    );

    const recipientUserIds = threadMemberUserIds.filter((userId) => userId !== authResult.user_id);
    const shouldSendPush = Boolean(text || imageId);
    if (recipientUserIds.length > 0 && shouldSendPush) {
      const previewText = text?.trim() || (imageId ? "Sent a photo" : "Sent a message");
      void sendPushToUsers({
        recipientUserIds,
        payload: {
          title: `${authResult.username} in ${thread.name}`,
          body: previewText,
          url: `/?tab=groups&thread_id=${encodeURIComponent(thread.id)}`,
          thread_id: thread.id,
        },
      }).catch((error) => {
        console.error("thread_send_push_dispatch_failed", error);
      });
    }

    publishThreadMessagePosted(threadMemberUserIds, {
      thread_id: thread.id,
      message_id: message.id,
      created_by: message.created_by,
    });

    let image_access_grant: string | null = null;
    if (message.image_id) {
      try {
        image_access_grant = createMainBucketImageAccessGrant({
          imageId: message.image_id,
          storageUserId: message.created_by,
          viewerUserId: authResult.user_id,
        });
      } catch (error) {
        console.error("thread_send_image_grant_failed", message.id, error);
      }
    }

    const payload: ThreadSendResponse = {
      message: {
        id: message.id,
        text: message.text ?? "",
        created_at: message.created_at.toISOString(),
        created_by: message.created_by,
        parent_id: message.parent_id,
        image_id: message.image_id,
        image_url: null,
        image_access_grant,
        data: message.data as MessageData | null,
        direct_reply_count: 0,
        username: messageAuthor?.username ?? "unknown",
      },
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("thread_send_failed", error);
    return NextResponse.json(
      { error: { code: "thread_send_failed", message: "Failed to send message." } },
      { status: 500 },
    );
  }
}
