import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/app/lib/prisma";

const asMessageDataObject = (value: Prisma.JsonValue | null): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export type PostSectionMessageForPath = {
  id: string;
  post_id: string | null;
  parent_id: string | null;
  root_parent_id: string | null;
  created_by: string;
  data: Prisma.JsonValue | null;
};

/** Resolves the parent for a new comment and validates the path stays under the same post section. */
export const resolveValidatedReplyParent = async (args: {
  postId: string;
  sectionRootId: string;
  parentPath: string[];
}): Promise<
  | { ok: true; replyParent: PostSectionMessageForPath }
  | { ok: false; status: 400 | 403; code: string; message: string }
> => {
  const { postId, sectionRootId, parentPath } = args;

  const sectionRoot = await prisma.thread_messages.findFirst({
    where: { id: sectionRootId, post_id: postId },
    select: { id: true, post_id: true, parent_id: true, root_parent_id: true, created_by: true, data: true },
  });
  if (!sectionRoot || !sectionRoot.parent_id) {
    return { ok: false, status: 400, code: "post_not_found", message: "Post section not found." };
  }

  if (parentPath.length === 0) {
    return { ok: true, replyParent: sectionRoot as PostSectionMessageForPath };
  }

  const pathIds = [...new Set(parentPath.filter(Boolean))];
  if (pathIds.length !== parentPath.length) {
    return { ok: false, status: 400, code: "invalid_parent_path", message: "Parent path is invalid." };
  }

  const messages = await prisma.thread_messages.findMany({
    where: { id: { in: pathIds } },
    select: { id: true, post_id: true, parent_id: true, root_parent_id: true, created_by: true, data: true },
  });
  const byId = new Map(messages.map((m) => [m.id, m] as const));

  for (const id of pathIds) {
    if (!byId.has(id)) {
      return { ok: false, status: 400, code: "invalid_parent_path", message: "Parent path is invalid." };
    }
  }

  const first = byId.get(parentPath[0]!);
  if (!first || first.post_id !== postId) {
    return { ok: false, status: 403, code: "invalid_parent_path", message: "Parent path is not in this post." };
  }
  if (first.parent_id !== sectionRootId) {
    return { ok: false, status: 403, code: "invalid_parent_path", message: "Parent path is not in this section." };
  }

  for (let i = 1; i < parentPath.length; i += 1) {
    const prevId = parentPath[i - 1]!;
    const node = byId.get(parentPath[i]!);
    if (!node || node.parent_id !== prevId) {
      return { ok: false, status: 400, code: "invalid_parent_path", message: "Parent path is invalid." };
    }
  }

  const last = byId.get(parentPath[parentPath.length - 1]!)!;
  if (last.post_id !== postId) {
    return { ok: false, status: 403, code: "invalid_parent_path", message: "Parent path is not in this post." };
  }
  if (asMessageDataObject(last.data).post_kind === "post_like") {
    return { ok: false, status: 400, code: "invalid_parent_path", message: "Cannot reply to a like row." };
  }
  return { ok: true, replyParent: last as PostSectionMessageForPath };
};

/**
 * `comment_path` is an ordered chain from a direct child of the section root to the comment
 * to delete (same shape as `parent_path` for replies, with the last id being the target).
 */
export const resolveValidatedCommentTarget = async (args: {
  postId: string;
  sectionRootId: string;
  commentPath: string[];
}): Promise<
  | { ok: true; target: PostSectionMessageForPath }
  | { ok: false; status: 400 | 403; code: string; message: string }
> => {
  const { postId, sectionRootId, commentPath } = args;
  if (commentPath.length === 0) {
    return { ok: false, status: 400, code: "invalid_comment_path", message: "Comment path is required." };
  }
  if (new Set(commentPath).size !== commentPath.length) {
    return { ok: false, status: 400, code: "invalid_comment_path", message: "Comment path is invalid." };
  }

  const pathIds = [...new Set(commentPath)] as string[];
  const messages = await prisma.thread_messages.findMany({
    where: { id: { in: pathIds } },
    select: { id: true, post_id: true, parent_id: true, root_parent_id: true, created_by: true, data: true },
  });
  const byId = new Map(messages.map((m) => [m.id, m] as const));

  for (const id of commentPath) {
    const row = byId.get(id);
    if (!row) {
      return { ok: false, status: 400, code: "invalid_comment_path", message: "Comment path is invalid." };
    }
    if (row.post_id !== postId) {
      return { ok: false, status: 403, code: "invalid_comment_path", message: "Comment is not in this post." };
    }
  }

  const first = byId.get(commentPath[0]!)!;
  if (first.parent_id !== sectionRootId) {
    return { ok: false, status: 403, code: "invalid_comment_path", message: "Comment is not in this section." };
  }
  for (let i = 1; i < commentPath.length; i += 1) {
    const child = byId.get(commentPath[i]!)!;
    if (child.parent_id !== commentPath[i - 1]!) {
      return { ok: false, status: 400, code: "invalid_comment_path", message: "Comment path is invalid." };
    }
  }

  const last = byId.get(commentPath[commentPath.length - 1]!)!;
  if (last.id === sectionRootId) {
    return { ok: false, status: 400, code: "invalid_comment_path", message: "Cannot delete the post body this way." };
  }
  if (asMessageDataObject(last.data).post_kind === "post_like") {
    return { ok: false, status: 400, code: "invalid_comment_path", message: "Not a deletable comment." };
  }
  return { ok: true, target: last as PostSectionMessageForPath };
};

export const getPostSectionRootMessageRows = async (postId: string) => {
  const allThreads = await prisma.threads.findMany({ select: { id: true } });
  if (allThreads.length === 0) {
    return [] as { id: string; created_by: string; image_id: string | null; data: Prisma.JsonValue | null }[];
  }
  return prisma.thread_messages.findMany({
    where: {
      post_id: postId,
      parent_id: { in: allThreads.map((t) => t.id) },
    },
    select: {
      id: true,
      created_by: true,
      image_id: true,
      data: true,
    },
  });
};
