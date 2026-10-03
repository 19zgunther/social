import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { sendPushToUsers } from "@/app/lib/push_notifications";
import { sanitizeNotificationText } from "@/app/lib/notification_text";
import { sanitizePostDataForViewer } from "@/app/lib/polls";
import {
  asSharedPostDataObject,
  getSharedPostPhase,
} from "@/app/lib/sharedPosts";
import type {
  SharedPostCommentRequest,
  SharedPostCommentResponse,
} from "@/app/types/interfaces";

type CommentNode = {
  username: string;
  user_id: string;
  text: string;
  replies: Record<string, CommentNode>;
  deleted?: boolean;
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

const loadReleasedInviteeSharedPost = async (sharedPostId: string, viewerUserId: string) => {
  const membership = await prisma.shared_posts_contributors.findFirst({
    where: {
      shared_post_id: sharedPostId,
      user_id: viewerUserId,
    },
    select: { id: true },
  });
  if (!membership) {
    return { error: { status: 403 as const, code: "not_allowed", message: "You cannot comment on this shared post." } };
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
    return { error: { status: 404 as const, code: "not_found", message: "Shared post not found." } };
  }
  if (getSharedPostPhase(existing.close_at, existing.release_at) !== "released") {
    return {
      error: {
        status: 400 as const,
        code: "not_released",
        message: "Comments are only available after release.",
      },
    };
  }
  return { existing };
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("shared_post_comment_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as SharedPostCommentRequest;
    const sharedPostId = body.shared_post_id?.trim() ?? "";
    const message = body.message?.trim() ?? "";
    const parentPath = Array.isArray(body.parent_path) ? body.parent_path : [];
    if (!sharedPostId || !message) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "shared_post_id and message are required.",
          },
        },
        { status: 400 },
      );
    }

    const loaded = await loadReleasedInviteeSharedPost(sharedPostId, authResult.user_id);
    if ("error" in loaded && loaded.error) {
      return NextResponse.json(
        { error: { code: loaded.error.code, message: loaded.error.message } },
        { status: loaded.error.status },
      );
    }
    const existing = loaded.existing!;

    const dataObject = asSharedPostDataObject(existing.data);
    const comments = cloneCommentTree((dataObject.comments as Record<string, CommentNode> | undefined) ?? {});
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

    const updated = await prisma.shared_posts.update({
      where: { id: sharedPostId },
      data: { data: nextData },
      select: {
        data: true,
        created_by: true,
      },
    });

    const notificationRecipientUserId =
      parentPath.length === 0 ? updated.created_by : nestedReplyTargetAuthorUserId;
    if (notificationRecipientUserId && notificationRecipientUserId !== authResult.user_id) {
      const sanitizedMessage = sanitizeNotificationText(message);
      const previewSource = sanitizedMessage || "Sent a reply";
      const previewText =
        previewSource.length > 80 ? `${previewSource.slice(0, 77)}...` : previewSource;
      const bodyText =
        parentPath.length === 0
          ? `${authResult.username} replied to your shared event: ${previewText}`
          : `${authResult.username} replied to your comment: ${previewText}`;
      sendPushToUsers({
        recipientUserIds: [notificationRecipientUserId],
        payload: {
          title: "New reply",
          body: bodyText,
          url: "/?tab=feed",
        },
      }).catch((error) => {
        console.error("shared_post_comment_push_dispatch_failed", error);
      });
    }

    const payload: SharedPostCommentResponse = {
      data: sanitizePostDataForViewer({
        data: updated.data,
        viewerUserId: authResult.user_id,
        authorUserId: updated.created_by,
      }),
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    if (error instanceof CommentFailureError) {
      return NextResponse.json({ error: error.failure.error }, { status: error.failure.status });
    }
    console.error("shared_post_comment_failed", error);
    return NextResponse.json(
      { error: { code: "shared_post_comment_failed", message: "Failed to add comment." } },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("shared_post_comment_delete_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as SharedPostCommentRequest;
    const sharedPostId = body.shared_post_id?.trim() ?? "";
    const commentPath = Array.isArray(body.comment_path) ? body.comment_path : [];
    if (!sharedPostId || commentPath.length === 0) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "shared_post_id and comment_path are required.",
          },
        },
        { status: 400 },
      );
    }

    const loaded = await loadReleasedInviteeSharedPost(sharedPostId, authResult.user_id);
    if ("error" in loaded && loaded.error) {
      return NextResponse.json(
        { error: { code: loaded.error.code, message: loaded.error.message } },
        { status: loaded.error.status },
      );
    }
    const existing = loaded.existing!;

    const dataObject = asSharedPostDataObject(existing.data);
    const comments = cloneCommentTree((dataObject.comments as Record<string, CommentNode> | undefined) ?? {});
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
    if (Object.keys(preservedReplies).length > 0) {
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

    const updated = await prisma.shared_posts.update({
      where: { id: sharedPostId },
      data: { data: nextData },
      select: {
        data: true,
        created_by: true,
      },
    });

    const payload: SharedPostCommentResponse = {
      data: sanitizePostDataForViewer({
        data: updated.data,
        viewerUserId: authResult.user_id,
        authorUserId: updated.created_by,
      }),
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    if (error instanceof CommentFailureError) {
      return NextResponse.json({ error: error.failure.error }, { status: error.failure.status });
    }
    console.error("shared_post_comment_delete_failed", error);
    return NextResponse.json(
      {
        error: {
          code: "shared_post_comment_delete_failed",
          message: "Failed to delete comment.",
        },
      },
      { status: 500 },
    );
  }
}
