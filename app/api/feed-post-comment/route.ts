import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";

type FeedPostCommentBody = {
  post_id?: string;
  parent_path?: string[];
  message?: string;
};

type CommentNode = {
  username: string;
  user_id: string;
  text: string;
  replies: Record<string, CommentNode>;
};

type PostData = {
  likes?: Record<string, boolean>;
  comments?: Record<string, CommentNode>;
};

const asPostDataObject = (value: Prisma.JsonValue | null): PostData => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as PostData;
};

const cloneCommentTree = (comments: Record<string, CommentNode>): Record<string, CommentNode> => {
  const cloned: Record<string, CommentNode> = {};
  for (const [key, comment] of Object.entries(comments)) {
    cloned[key] = {
      username: comment.username,
      user_id: comment.user_id,
      text: comment.text,
      replies: cloneCommentTree(comment.replies ?? {}),
    };
  }
  return cloned;
};

const createCommentKey = (existingMap: Record<string, CommentNode>): string => {
  const base = new Date().toISOString();
  if (!existingMap[base]) {
    return base;
  }
  let suffix = 1;
  while (existingMap[`${base}-${suffix}`]) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("feed_post_comment_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as FeedPostCommentBody;
    const postId = body.post_id?.trim();
    const message = body.message?.trim();
    const parentPath = Array.isArray(body.parent_path) ? body.parent_path : [];
    if (!postId || !message) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "post_id and message are required." } },
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
          { error: { code: "not_allowed", message: "You cannot comment on this post." } },
          { status: 403 },
        );
      }
    }

    const dataObject = asPostDataObject(post.data as Prisma.JsonValue | null);
    const comments = cloneCommentTree(dataObject.comments ?? {});
    let targetMap = comments;

    for (const pathKey of parentPath) {
      const targetComment = targetMap[pathKey];
      if (!targetComment) {
        return NextResponse.json(
          { error: { code: "invalid_parent_path", message: "Parent path is invalid." } },
          { status: 400 },
        );
      }
      targetComment.replies = targetComment.replies ?? {};
      targetMap = targetComment.replies;
    }

    const newCommentKey = createCommentKey(targetMap);
    targetMap[newCommentKey] = {
      username: authResult.username,
      user_id: authResult.user_id,
      text: message,
      replies: {},
    };

    const nextData: Prisma.InputJsonValue = {
      ...dataObject,
      comments,
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

    return NextResponse.json({ data: updated.data }, { status: 200 });
  } catch (error) {
    console.error("feed_post_comment_failed", error);
    return NextResponse.json(
      { error: { code: "feed_post_comment_failed", message: "Failed to add comment." } },
      { status: 500 },
    );
  }
}
