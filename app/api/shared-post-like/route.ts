import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { sanitizePostDataForViewer } from "@/app/lib/polls";
import {
  asSharedPostDataObject,
  getSharedPostPhase,
} from "@/app/lib/sharedPosts";
import type { SharedPostLikeRequest, SharedPostLikeResponse } from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("shared_post_like_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as SharedPostLikeRequest;
    const sharedPostId = body.shared_post_id?.trim() ?? "";
    const like = body.like;
    if (!sharedPostId || typeof like !== "boolean") {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "shared_post_id and like are required.",
          },
        },
        { status: 400 },
      );
    }

    const membership = await prisma.shared_posts_contributors.findFirst({
      where: {
        shared_post_id: sharedPostId,
        user_id: authResult.user_id,
      },
      select: { id: true },
    });
    if (!membership) {
      return NextResponse.json(
        { error: { code: "not_allowed", message: "You cannot like this shared post." } },
        { status: 403 },
      );
    }

    const existing = await prisma.shared_posts.findFirst({
      where: { id: sharedPostId },
      select: {
        id: true,
        created_by: true,
        close_at: true,
        release_at: true,
        data: true,
      },
    });
    if (!existing) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Shared post not found." } },
        { status: 404 },
      );
    }
    if (getSharedPostPhase(existing.close_at, existing.release_at) !== "released") {
      return NextResponse.json(
        {
          error: {
            code: "not_released",
            message: "Likes are only available after release.",
          },
        },
        { status: 400 },
      );
    }

    const dataObject = asSharedPostDataObject(existing.data);
    const likes = { ...(dataObject.likes ?? {}) };
    if (like) {
      likes[authResult.user_id] = true;
    } else {
      delete likes[authResult.user_id];
    }
    const nextData: Prisma.InputJsonValue = {
      ...dataObject,
      likes,
    } as Prisma.InputJsonValue;

    const updated = await prisma.shared_posts.update({
      where: { id: sharedPostId },
      data: { data: nextData },
      select: {
        data: true,
        created_by: true,
      },
    });

    const updatedData = asSharedPostDataObject(updated.data);
    const likeCount = Object.values(updatedData.likes ?? {}).filter(Boolean).length;
    const isLikedByViewer = Boolean(updatedData.likes?.[authResult.user_id]);
    const payload: SharedPostLikeResponse = {
      data: sanitizePostDataForViewer({
        data: updated.data,
        viewerUserId: authResult.user_id,
        authorUserId: updated.created_by,
      }),
      like_count: likeCount,
      is_liked_by_viewer: isLikedByViewer,
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("shared_post_like_failed", error);
    return NextResponse.json(
      { error: { code: "shared_post_like_failed", message: "Failed to update like." } },
      { status: 500 },
    );
  }
}
