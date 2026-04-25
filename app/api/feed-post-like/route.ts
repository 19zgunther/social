import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { FeedPostLikeRequest, PostData } from "@/app/types/interfaces";

const asMessageDataObject = (value: Prisma.JsonValue | null): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("feed_post_like_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as FeedPostLikeRequest;
    const postId = body.post_id?.trim();
    const sectionId = body.section_id?.trim();
    const like = body.like;
    if (!postId || !sectionId || typeof like !== "boolean") {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "post_id, section_id and like are required." } },
        { status: 400 },
      );
    }

    const sectionRoot = await prisma.thread_messages.findFirst({
      where: {
        id: sectionId,
        post_id: postId,
      },
      select: {
        id: true,
        created_by: true,
        parent_id: true,
      },
    });
    if (!sectionRoot || !sectionRoot.parent_id) {
      return NextResponse.json(
        { error: { code: "post_not_found", message: "Post section not found." } },
        { status: 404 },
      );
    }

    const thread = await prisma.threads.findFirst({
      where: {
        id: sectionRoot.parent_id,
        OR: [{ owner: authResult.user_id }, { user_thread_access: { some: { user_id: authResult.user_id } } }],
      },
      select: { id: true },
    });
    if (!thread) {
      return NextResponse.json(
        { error: { code: "not_allowed", message: "You cannot like this post." } },
        { status: 403 },
      );
    }

    await prisma.thread_messages.create({
      data: {
        created_by: authResult.user_id,
        parent_id: sectionRoot.id,
        post_id: postId,
        root_parent_id: sectionRoot.id,
        text: like ? "1" : "0",
        data: {
          post_kind: "post_like",
        } as Prisma.InputJsonValue,
      },
    });

    const sectionReplies = await prisma.thread_messages.findMany({
      where: { parent_id: sectionRoot.id },
      select: {
        created_by: true,
        created_at: true,
        text: true,
        data: true,
      },
    });
    const latestLikeByUser = new Map<string, { ts: number; value: boolean }>();
    sectionReplies.forEach((reply) => {
      const data = asMessageDataObject(reply.data);
      if (data.post_kind !== "post_like") {
        return;
      }
      const ts = reply.created_at.getTime();
      const prev = latestLikeByUser.get(reply.created_by);
      if (!prev || ts >= prev.ts) {
        latestLikeByUser.set(reply.created_by, { ts, value: reply.text === "1" });
      }
    });
    const likes: Record<string, boolean> = {};
    latestLikeByUser.forEach((entry, userId) => {
      if (entry.value) {
        likes[userId] = true;
      }
    });
    const data: PostData = { likes };
    const likeCount = Object.values(likes).filter(Boolean).length;
    const isLikedByViewer = Boolean(likes[authResult.user_id]);

    return NextResponse.json(
      {
        data,
        like_count: likeCount,
        is_liked_by_viewer: isLikedByViewer,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("feed_post_like_failed", error);
    return NextResponse.json(
      { error: { code: "feed_post_like_failed", message: "Failed to update post like." } },
      { status: 500 },
    );
  }
}
