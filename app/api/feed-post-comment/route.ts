import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { sendPushToUsers } from "@/app/lib/push_notifications";
import { sanitizeNotificationText } from "@/app/lib/notification_text";
import { canViewerAccessPost } from "@/app/lib/postVisibility";
import { sanitizePostDataForViewer } from "@/app/lib/polls";

type FeedPostCommentBody = {
  post_id?: string;
  parent_path?: string[];
  message?: string;
  comment_path?: string[];
};

type CommentNode = {
  username: string;
  user_id: string;
  text: string;
  replies: Record<string, CommentNode>;
  deleted?: boolean;
};

type PostData = {
  likes?: Record<string, boolean>;
  comments?: Record<string, CommentNode>;
};

type CommentFailure = {
  status: 400 | 403 | 404;
  error: { code: string; message: string };
};

class CommentFailureError extends Error {
  readonly failure: CommentFailure;

  constructor(failure: CommentFailure) {
    super(failure.error.message);
    this.name = "CommentFailureError";
    this.failure = failure;
  }
}

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
      ...(comment.deleted ? { deleted: true } : {}),
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

    const postMeta = await prisma.posts.findFirst({
      where: {
        id: postId,
      },
      select: {
        id: true,
        created_by: true,
        permanent: true,
      },
    });
    if (!postMeta) {
      return NextResponse.json(
        { error: { code: "post_not_found", message: "Post not found." } },
        { status: 404 },
      );
    }

    const allowed = await canViewerAccessPost({
      viewerUserId: authResult.user_id,
      post: postMeta,
    });
    if (!allowed) {
      return NextResponse.json(
        { error: { code: "not_allowed", message: "You cannot comment on this post." } },
        { status: 403 },
      );
    }

    const { updated, replyTargetAuthorUserId } = await prisma.$transaction(async (tx) => {
      const lockedRows = await tx.$queryRaw<
        Array<{
          id: string;
          created_by: string;
          data: Prisma.JsonValue | null;
        }>
      >`
        SELECT id, created_by, data
        FROM posts
        WHERE id = ${postId}::uuid
        FOR UPDATE
      `;
      const post = lockedRows[0];
      if (!post) {
        throw new CommentFailureError({
          status: 404,
          error: { code: "post_not_found", message: "Post not found." },
        });
      }

      const dataObject = asPostDataObject(post.data);
      const comments = cloneCommentTree(dataObject.comments ?? {});
      let targetMap = comments;
      let nestedReplyTargetAuthorUserId: string | null = null;

      for (const pathKey of parentPath) {
        const targetComment = targetMap[pathKey];
        if (!targetComment) {
          throw new CommentFailureError({
            status: 400,
            error: { code: "invalid_parent_path", message: "Parent path is invalid." },
          });
        }
        nestedReplyTargetAuthorUserId = targetComment.user_id;
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

      const updatedPost = await tx.posts.update({
        where: {
          id: post.id,
        },
        data: {
          data: nextData,
        },
        select: {
          data: true,
          created_by: true,
        },
      });

      return {
        updated: updatedPost,
        replyTargetAuthorUserId: nestedReplyTargetAuthorUserId,
      };
    });

    // Send a push notification to the recipient of the comment (either the post owner or the comment author)
    const notificationRecipientUserId =
      parentPath.length === 0 ? updated.created_by : replyTargetAuthorUserId;
    if (notificationRecipientUserId && notificationRecipientUserId !== authResult.user_id) {
      const sanitizedMessage = sanitizeNotificationText(message);
      const previewSource = sanitizedMessage || "Sent a reply";
      const previewText =
        previewSource.length > 80 ? `${previewSource.slice(0, 77)}...` : previewSource;
      const body =
        parentPath.length === 0
          ? `${authResult.username} replied to your post: ${previewText}`
          : `${authResult.username} replied to your comment: ${previewText}`;
      sendPushToUsers({
        recipientUserIds: [notificationRecipientUserId],
        payload: {
          title: "New reply",
          body,
          url: "/?tab=feed",
        },
      }).catch((error) => {
        console.error("feed_post_comment_push_dispatch_failed", error);
      });
    }

    const sanitizedData = sanitizePostDataForViewer({
      data: updated.data,
      viewerUserId: authResult.user_id,
      authorUserId: updated.created_by,
    });

    return NextResponse.json({ data: sanitizedData }, { status: 200 });
  } catch (error) {
    if (error instanceof CommentFailureError) {
      return NextResponse.json({ error: error.failure.error }, { status: error.failure.status });
    }
    console.error("feed_post_comment_failed", error);
    return NextResponse.json(
      { error: { code: "feed_post_comment_failed", message: "Failed to add comment." } },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("feed_post_comment_delete_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as FeedPostCommentBody;
    const postId = body.post_id?.trim();
    const commentPath = Array.isArray(body.comment_path) ? body.comment_path : [];
    if (!postId || commentPath.length === 0) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "post_id and comment_path are required." } },
        { status: 400 },
      );
    }

    const postMeta = await prisma.posts.findFirst({
      where: {
        id: postId,
      },
      select: {
        id: true,
        created_by: true,
        permanent: true,
      },
    });
    if (!postMeta) {
      return NextResponse.json(
        { error: { code: "post_not_found", message: "Post not found." } },
        { status: 404 },
      );
    }

    const allowed = await canViewerAccessPost({
      viewerUserId: authResult.user_id,
      post: postMeta,
    });
    if (!allowed) {
      return NextResponse.json(
        { error: { code: "not_allowed", message: "You cannot delete comments on this post." } },
        { status: 403 },
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      const lockedRows = await tx.$queryRaw<
        Array<{
          id: string;
          created_by: string;
          data: Prisma.JsonValue | null;
        }>
      >`
        SELECT id, created_by, data
        FROM posts
        WHERE id = ${postId}::uuid
        FOR UPDATE
      `;
      const post = lockedRows[0];
      if (!post) {
        throw new CommentFailureError({
          status: 404,
          error: { code: "post_not_found", message: "Post not found." },
        });
      }

      const dataObject = asPostDataObject(post.data);
      const comments = cloneCommentTree(dataObject.comments ?? {});
      let targetMap = comments;

      for (const pathKey of commentPath.slice(0, -1)) {
        const targetComment = targetMap[pathKey];
        if (!targetComment) {
          throw new CommentFailureError({
            status: 400,
            error: { code: "invalid_comment_path", message: "Comment path is invalid." },
          });
        }
        targetComment.replies = targetComment.replies ?? {};
        targetMap = targetComment.replies;
      }

      const targetKey = commentPath[commentPath.length - 1];
      const targetComment = targetMap[targetKey];
      if (!targetComment) {
        throw new CommentFailureError({
          status: 400,
          error: { code: "invalid_comment_path", message: "Comment path is invalid." },
        });
      }

      if (targetComment.user_id !== authResult.user_id) {
        throw new CommentFailureError({
          status: 403,
          error: { code: "not_allowed", message: "You can only delete your own comments." },
        });
      }

      const preservedReplies = targetComment.replies ?? {};
      const hasReplies = Object.keys(preservedReplies).length > 0;
      if (hasReplies) {
        targetMap[targetKey] = {
          username: "",
          user_id: "",
          text: "Comment Deleted",
          replies: preservedReplies,
          deleted: true,
        };
      } else {
        delete targetMap[targetKey];
      }

      const nextData: Prisma.InputJsonValue = {
        ...dataObject,
        comments,
      } as Prisma.InputJsonValue;

      return tx.posts.update({
        where: {
          id: post.id,
        },
        data: {
          data: nextData,
        },
        select: {
          data: true,
          created_by: true,
        },
      });
    });

    const sanitizedData = sanitizePostDataForViewer({
      data: updated.data,
      viewerUserId: authResult.user_id,
      authorUserId: updated.created_by,
    });

    return NextResponse.json({ data: sanitizedData }, { status: 200 });
  } catch (error) {
    if (error instanceof CommentFailureError) {
      return NextResponse.json({ error: error.failure.error }, { status: error.failure.status });
    }
    console.error("feed_post_comment_delete_failed", error);
    return NextResponse.json(
      { error: { code: "feed_post_comment_delete_failed", message: "Failed to delete comment." } },
      { status: 500 },
    );
  }
}
