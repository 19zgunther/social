import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { createThreadBucketImageAccessGrant } from "@/app/api/image_access_grant";
import { prisma } from "@/app/lib/prisma";
import {
  findDirectThreadBetweenUsers,
} from "@/app/lib/threadDirect";
import type { ThreadItem } from "@/app/types/interfaces";

type ThreadDirectOpenBody = {
  other_user_id?: string;
};

function toThreadItemPayload(input: {
  thread: {
    id: string;
    name: string;
    created_at: Date;
    owner: string;
    image_id: string | null;
    users: { username: string };
    user_thread_access: { user_id: string }[];
  };
  viewerUserId: string;
}): ThreadItem {
  const { thread, viewerUserId } = input;
  let image_access_grant: string | null = null;
  if (thread.image_id) {
    try {
      image_access_grant = createThreadBucketImageAccessGrant({
        imageId: thread.image_id,
        threadId: thread.id,
        viewerUserId,
      });
    } catch (error) {
      console.error("thread_direct_open_image_grant_failed", thread.id, error);
    }
  }

  return {
    id: thread.id,
    name: thread.name,
    created_at: thread.created_at.toISOString(),
    owner_user_id: thread.owner,
    owner_username: thread.users.username,
    participant_count: 2,
    is_direct: true,
    image_id: thread.image_id,
    image_url: null,
    image_access_grant,
    last_message_at: null,
    last_message_from_self: false,
    last_photo_preview: null,
  };
}

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("thread_direct_open_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ThreadDirectOpenBody;
    const otherUserId = body.other_user_id?.trim();

    if (!otherUserId) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "other_user_id is required." } },
        { status: 400 },
      );
    }

    if (otherUserId === authResult.user_id) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "Cannot start a direct thread with yourself." } },
        { status: 400 },
      );
    }

    const otherUser = await prisma.users.findUnique({
      where: { id: otherUserId },
      select: { id: true, username: true },
    });

    if (!otherUser) {
      return NextResponse.json(
        { error: { code: "user_not_found", message: "User not found." } },
        { status: 404 },
      );
    }

    const existing = await findDirectThreadBetweenUsers(prisma, authResult.user_id, otherUser.id);
    if (existing) {
      const thread = toThreadItemPayload({
        thread: existing,
        viewerUserId: authResult.user_id,
      });
      return NextResponse.json({ thread }, { status: 200 });
    }

    const created = await prisma.$transaction(async (tx) => {
      const thread = await tx.threads.create({
        data: {
          owner: authResult.user_id,
          name: otherUser.username + ' & ' + authResult.username,
          is_direct: true,
        },
        select: {
          id: true,
          name: true,
          created_at: true,
          owner: true,
          image_id: true,
          users: { select: { username: true } },
          user_thread_access: { select: { user_id: true } },
        },
      });

      await tx.user_thread_access.create({
        data: {
          thread_id: thread.id,
          user_id: otherUser.id,
          created_at: new Date(),
        },
      });

      const withAccess = await tx.threads.findUnique({
        where: { id: thread.id },
        select: {
          id: true,
          name: true,
          created_at: true,
          owner: true,
          image_id: true,
          users: { select: { username: true } },
          user_thread_access: { select: { user_id: true } },
        },
      });

      if (!withAccess) {
        throw new Error("thread_missing_after_create");
      }

      return withAccess;
    });

    const thread = toThreadItemPayload({
      thread: created,
      viewerUserId: authResult.user_id,
    });

    return NextResponse.json({ thread }, { status: 200 });
  } catch (error) {
    console.error("thread_direct_open_failed", error);
    return NextResponse.json(
      { error: { code: "thread_direct_open_failed", message: "Failed to open direct thread." } },
      { status: 500 },
    );
  }
}
