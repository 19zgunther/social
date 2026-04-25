import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { sendPushToUsers } from "@/app/lib/push_notifications";
import { sanitizeNotificationText } from "@/app/lib/notification_text";
import { computePostSectionReplyRootParentId } from "@/app/api/thread_message_root_parent";
import { resolveValidatedCommentTarget, resolveValidatedReplyParent } from "@/app/api/post_section_path_utils";
import { FeedPostCommentRequest, PostData, PostCommentNode } from "@/app/types/interfaces";

const asMessageDataObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const buildSectionData = async (sectionId: string): Promise<PostData> => {
  const rows = await prisma.thread_messages.findMany({
    where: {
      OR: [
        { id: sectionId },
        { root_parent_id: sectionId },
        { AND: [{ parent_id: sectionId }, { root_parent_id: null }] },
      ],
    },
    select: {
      id: true,
      parent_id: true,
      root_parent_id: true,
      created_by: true,
      created_at: true,
      text: true,
      data: true,
      users: { select: { username: true } },
    },
  });
  const byParent = new Map<string, typeof rows>();
  rows.forEach((row) => {
    if (!row.parent_id) return;
    const list = byParent.get(row.parent_id) ?? [];
    list.push(row);
    byParent.set(row.parent_id, list);
  });
  const latestLikeByUser = new Map<string, { ts: number; value: boolean }>();
  const buildTree = (parentId: string): Record<string, PostCommentNode> => {
    const children = (byParent.get(parentId) ?? []).sort((a, b) =>
      a.created_at.getTime() - b.created_at.getTime() || a.id.localeCompare(b.id),
    );
    const out: Record<string, PostCommentNode> = {};
    children.forEach((child) => {
      const data = asMessageDataObject(child.data);
      if (data.post_kind === "post_like") {
        const ts = child.created_at.getTime();
        const prev = latestLikeByUser.get(child.created_by);
        if (!prev || ts >= prev.ts) {
          latestLikeByUser.set(child.created_by, { ts, value: child.text === "1" });
        }
        return;
      }
      const trimmed = child.text?.trim() ?? "";
      out[child.id] = {
        username: trimmed ? child.users.username : "",
        user_id: child.created_by,
        text: trimmed || "Comment Deleted",
        replies: buildTree(child.id),
        ...(trimmed ? {} : { deleted: true }),
      };
    });
    return out;
  };
  const comments = buildTree(sectionId);
  const likes: Record<string, boolean> = {};
  latestLikeByUser.forEach((entry, userId) => {
    if (entry.value) likes[userId] = true;
  });
  return {
    comments,
    likes,
  };
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("feed_post_comment_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as FeedPostCommentRequest;
    const postId = body.post_id?.trim();
    const sectionId = body.section_id?.trim();
    const message = body.message?.trim();
    const parentPath = Array.isArray(body.parent_path) ? body.parent_path : [];
    if (!postId || !sectionId || !message) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "post_id, section_id and message are required." } },
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
        { error: { code: "not_allowed", message: "You cannot comment on this post." } },
        { status: 403 },
      );
    }

    const replyResolution = await resolveValidatedReplyParent({
      postId,
      sectionRootId: sectionRoot.id,
      parentPath: parentPath.map((id) => (typeof id === "string" ? id.trim() : "")).filter(Boolean),
    });
    if (!replyResolution.ok) {
      return NextResponse.json(
        { error: { code: replyResolution.code, message: replyResolution.message } },
        { status: replyResolution.status },
      );
    }
    const replyParent = replyResolution.replyParent;
    const rootParentId = computePostSectionReplyRootParentId(sectionRoot.id, {
      id: replyParent.id,
      parent_id: replyParent.parent_id,
      root_parent_id: replyParent.root_parent_id,
    });

    await prisma.thread_messages.create({
      data: {
        created_by: authResult.user_id,
        parent_id: replyParent.id,
        post_id: postId,
        image_id: null,
        updated_at: new Date(),
        root_parent_id: rootParentId,
        text: message,
      },
    });

    const notificationRecipientUserId = parentPath.length === 0 ? sectionRoot.created_by : null;
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

    const data = await buildSectionData(sectionId);
    return NextResponse.json({ data }, { status: 200 });
  } catch (error) {
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
    const body = (await request.json()) as FeedPostCommentRequest;
    const postId = body.post_id?.trim();
    const sectionId = body.section_id?.trim();
    const commentPath = Array.isArray(body.comment_path) ? body.comment_path : [];
    if (!postId || !sectionId || commentPath.length === 0) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "post_id, section_id and comment_path are required." } },
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
        { error: { code: "not_allowed", message: "You cannot delete comments on this post." } },
        { status: 403 },
      );
    }

    const pathResolution = await resolveValidatedCommentTarget({
      postId,
      sectionRootId: sectionRoot.id,
      commentPath: commentPath.map((id) => (typeof id === "string" ? id.trim() : "")).filter(Boolean),
    });
    if (!pathResolution.ok) {
      return NextResponse.json(
        { error: { code: pathResolution.code, message: pathResolution.message } },
        { status: pathResolution.status },
      );
    }
    if (pathResolution.target.created_by !== authResult.user_id) {
      return NextResponse.json(
        { error: { code: "not_allowed", message: "You can only delete your own comments." } },
        { status: 403 },
      );
    }

    await prisma.thread_messages.update({
      where: { id: pathResolution.target.id },
      data: {
        text: null,
      },
    });

    const data = await buildSectionData(sectionId);
    return NextResponse.json({ data }, { status: 200 });
  } catch (error) {
    console.error("feed_post_comment_delete_failed", error);
    return NextResponse.json(
      { error: { code: "feed_post_comment_delete_failed", message: "Failed to delete comment." } },
      { status: 500 },
    );
  }
}
