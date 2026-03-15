import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";

type FeedPostLikeBody = {
  post_id?: string;
  like?: boolean;
};

type PostData = {
  likes?: Record<string, boolean>;
  comments?: unknown;
};

const asPostDataObject = (value: Prisma.JsonValue | null): PostData => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as PostData;
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("feed_post_like_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as FeedPostLikeBody;
    const postId = body.post_id?.trim();
    const like = body.like;
    if (!postId || typeof like !== "boolean") {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "post_id and like are required." } },
        { status: 400 },
      );
    }

    const post = await prisma.posts.findFirst({
      where: {
        id: postId,
      },
      select: {
        id: true,
        created_by: true,
        data: true,
      },
    });
    if (!post) {
      return NextResponse.json(
        { error: { code: "post_not_found", message: "Post not found." } },
        { status: 404 },
      );
    }

    // Enforce same visibility rule as feed: own post or accepted friend.
    if (post.created_by !== authResult.user_id) {
      const friendRow = await prisma.friends.findFirst({
        where: {
          accepted: true,
          OR: [
            {
              requesting_user: authResult.user_id,
              other_user: post.created_by,
            },
            {
              requesting_user: post.created_by,
              other_user: authResult.user_id,
            },
          ],
        },
        select: { id: true },
      });
      if (!friendRow) {
        return NextResponse.json(
          { error: { code: "not_allowed", message: "You cannot like this post." } },
          { status: 403 },
        );
      }
    }

    const dataObject = asPostDataObject(post.data as Prisma.JsonValue | null);
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

    const updated = await prisma.posts.update({
      where: {
        id: post.id,
      },
      data: {
        data: nextData,
      },
      select: {
        data: true,
      },
    });

    const updatedData = asPostDataObject(updated.data as Prisma.JsonValue | null);
    const likeCount = Object.values(updatedData.likes ?? {}).filter(Boolean).length;
    const isLikedByViewer = Boolean(updatedData.likes?.[authResult.user_id]);

    return NextResponse.json(
      {
        data: updated.data,
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
