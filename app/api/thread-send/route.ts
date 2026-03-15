import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { publishThreadMessagePosted } from "@/app/lib/sync";
import {
  getSignedMainBucketImageUrl,
  uploadImageToMainBucket,
} from "@/app/api/server_file_storage_utils";

type ThreadSendBody = {
  thread_id?: string;
  text?: string;
  reply_to_message_id?: string;
  image_base64_data?: string;
  image_mime_type?: string;
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("thread_send_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ThreadSendBody;
    const threadId = body.thread_id?.trim();
    const text = body.text?.trim();
    const replyToMessageId = body.reply_to_message_id?.trim();
    const imageBase64Data = body.image_base64_data?.trim();
    const imageMimeType = body.image_mime_type?.trim();

    if (!threadId || (!text && !imageBase64Data)) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "thread_id and either text or image are required.",
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
      },
      select: {
        id: true,
        text: true,
        created_at: true,
        created_by: true,
        parent_id: true,
        image_id: true,
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
    publishThreadMessagePosted(threadMemberUserIds, {
      thread_id: thread.id,
      message_id: message.id,
      created_by: message.created_by,
    });

    let imageUrl: string | null = null;
    if (message.image_id) {
      imageUrl = await getSignedMainBucketImageUrl({
        userId: message.created_by,
        imageId: message.image_id,
      });
    }

    return NextResponse.json(
      {
        message: {
          id: message.id,
          text: message.text ?? "",
          created_at: message.created_at,
          created_by: message.created_by,
          parent_id: message.parent_id,
          image_id: message.image_id,
          image_url: imageUrl,
          username: message.users.username,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("thread_send_failed", error);
    return NextResponse.json(
      { error: { code: "thread_send_failed", message: "Failed to send message." } },
      { status: 500 },
    );
  }
}
