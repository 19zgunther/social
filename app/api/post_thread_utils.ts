import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/app/lib/prisma";
import { createMainBucketImageAccessGrant } from "@/app/api/image_access_grant";
import { MessageData, PostData, PostGroupSection, PostItem } from "@/app/types/interfaces";

const PAGE_SIZE_DEFAULT = 10;

type RootMessageRow = {
  id: string;
  post_id: string;
  created_at: Date;
  created_by: string;
  parent_id: string | null;
  text: string | null;
  image_id: string | null;
  data: Prisma.JsonValue | null;
  users: {
    username: string;
    email: string | null;
    profile_image_id: string | null;
  };
};

type MessageRow = {
  id: string;
  parent_id: string | null;
  root_parent_id: string | null;
  created_at: Date;
  created_by: string;
  text: string | null;
  data: Prisma.JsonValue | null;
};

type PostCommentNode = {
  username: string;
  user_id: string;
  text: string;
  replies: Record<string, PostCommentNode>;
  deleted?: boolean;
};

const asMessageData = (data: Prisma.JsonValue | null): MessageData | null => {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }
  return data as MessageData;
};

const isDeletedRoot = (root: RootMessageRow): boolean => {
  const data = asMessageData(root.data);
  return data?.post_kind === "post_deleted";
};

export const getAccessibleThreadIds = async (userId: string): Promise<string[]> => {
  const threads = await prisma.threads.findMany({
    where: {
      created_by_event: null,
      OR: [{ owner: userId }, { user_thread_access: { some: { user_id: userId } } }],
    },
    select: { id: true },
  });
  return threads.map((thread) => thread.id);
};

export const getSharedThreadIds = async (viewerUserId: string, targetUserId: string): Promise<string[]> => {
  const viewerThreads = await getAccessibleThreadIds(viewerUserId);
  if (viewerThreads.length === 0) {
    return [];
  }
  const targetThreadRows = await prisma.threads.findMany({
    where: {
      id: { in: viewerThreads },
      OR: [{ owner: targetUserId }, { user_thread_access: { some: { user_id: targetUserId } } }],
    },
    select: { id: true },
  });
  return targetThreadRows.map((thread) => thread.id);
};

const buildSectionData = (messages: MessageRow[], sectionRootId: string, viewerUserId: string): PostData => {
  const byId = new Map(messages.map((row) => [row.id, row]));
  const childrenByParent = new Map<string, MessageRow[]>();
  messages.forEach((message) => {
    if (!message.parent_id) {
      return;
    }
    const list = childrenByParent.get(message.parent_id) ?? [];
    list.push(message);
    childrenByParent.set(message.parent_id, list);
  });

  const likes: Record<string, boolean> = {};
  const likeTsByUser = new Map<string, number>();

  const buildCommentTree = (parentId: string): Record<string, PostCommentNode> => {
    const children = (childrenByParent.get(parentId) ?? []).sort((a, b) =>
      a.created_at.getTime() - b.created_at.getTime() || a.id.localeCompare(b.id),
    );
    const comments: Record<string, PostCommentNode> = {};
    for (const child of children) {
      const messageData = asMessageData(child.data);
      if (messageData?.post_kind === "post_like") {
        const ts = child.created_at.getTime();
        const prev = likeTsByUser.get(child.created_by) ?? 0;
        if (ts >= prev) {
          likes[child.created_by] = child.text === "1";
          likeTsByUser.set(child.created_by, ts);
        }
        continue;
      }
      const text = child.text?.trim() ?? "";
      const replies = buildCommentTree(child.id);
      comments[child.id] = {
        username: byId.get(child.id)?.created_by === viewerUserId ? "" : "",
        user_id: child.created_by,
        text: text || "Comment Deleted",
        replies,
        ...(text ? {} : { deleted: true }),
      };
    }
    return comments;
  };

  const comments = buildCommentTree(sectionRootId);
  const populatedLikes: Record<string, boolean> = {};
  Object.entries(likes).forEach(([userId, value]) => {
    if (value) {
      populatedLikes[userId] = true;
    }
  });
  return {
    comments,
    likes: populatedLikes,
  };
};

const hydrateCommentUsernames = async (
  sections: PostGroupSection[],
): Promise<PostGroupSection[]> => {
  const userIds = new Set<string>();
  const collect = (nodeMap: Record<string, PostCommentNode> | undefined) => {
    if (!nodeMap) {
      return;
    }
    Object.values(nodeMap).forEach((node) => {
      if (node.user_id) {
        userIds.add(node.user_id);
      }
      collect(node.replies);
    });
  };
  sections.forEach((section) => collect(section.data?.comments));
  if (userIds.size === 0) {
    return sections;
  }
  const users = await prisma.users.findMany({
    where: { id: { in: Array.from(userIds) } },
    select: { id: true, username: true },
  });
  const usernamesById = new Map(users.map((u) => [u.id, u.username]));
  const applyUsernames = (nodeMap: Record<string, PostCommentNode> | undefined) => {
    if (!nodeMap) {
      return;
    }
    Object.values(nodeMap).forEach((node) => {
      node.username = node.deleted ? "" : (usernamesById.get(node.user_id) ?? node.user_id);
      applyUsernames(node.replies);
    });
  };
  sections.forEach((section) => applyUsernames(section.data?.comments));
  return sections;
};

export const listThreadBackedPosts = async ({
  viewerUserId,
  visibleThreadIds,
  authorUserIds,
  cursorPostId,
  pageSize = PAGE_SIZE_DEFAULT,
}: {
  viewerUserId: string;
  visibleThreadIds: string[];
  authorUserIds?: string[];
  cursorPostId?: string;
  pageSize?: number;
}): Promise<{ posts: PostItem[]; hasMore: boolean; nextCursorPostId: string | null }> => {
  if (visibleThreadIds.length === 0) {
    return { posts: [], hasMore: false, nextCursorPostId: null };
  }

  const roots = await prisma.thread_messages.findMany({
    where: {
      parent_id: { in: visibleThreadIds },
      post_id: { not: null },
      ...(authorUserIds ? { created_by: { in: authorUserIds } } : {}),
    },
    orderBy: [{ created_at: "desc" }, { id: "desc" }],
    take: pageSize * 10,
    select: {
      id: true,
      post_id: true,
      created_at: true,
      created_by: true,
      parent_id: true,
      text: true,
      image_id: true,
      data: true,
      users: { select: { username: true, email: true, profile_image_id: true } },
    },
  });

  const dedupMap = new Map<string, RootMessageRow[]>();
  roots.forEach((root) => {
    if (!root.post_id) return;
    if (isDeletedRoot(root as RootMessageRow)) return;
    const list = dedupMap.get(root.post_id) ?? [];
    list.push(root as RootMessageRow);
    dedupMap.set(root.post_id, list);
  });

  const dedupedIds = Array.from(dedupMap.keys()).sort((a, b) => {
    const aRoot = dedupMap.get(a)?.[0];
    const bRoot = dedupMap.get(b)?.[0];
    if (!aRoot || !bRoot) return a.localeCompare(b);
    return bRoot.created_at.getTime() - aRoot.created_at.getTime() || b.localeCompare(a);
  });
  const startIndex = cursorPostId ? Math.max(0, dedupedIds.indexOf(cursorPostId) + 1) : 0;
  const pagePostIds = dedupedIds.slice(startIndex, startIndex + pageSize + 1);
  const hasMore = pagePostIds.length > pageSize;
  const effectivePostIds = pagePostIds.slice(0, pageSize);

  const sectionRootIds = effectivePostIds.flatMap((postId) =>
    (dedupMap.get(postId) ?? []).map((root) => root.id),
  );
  const descendants = await prisma.thread_messages.findMany({
    where: {
      OR: [
        { id: { in: sectionRootIds } },
        { root_parent_id: { in: sectionRootIds } },
        { AND: [{ parent_id: { in: sectionRootIds } }, { root_parent_id: null }] },
      ],
    },
    select: {
      id: true,
      parent_id: true,
      root_parent_id: true,
      created_at: true,
      created_by: true,
      text: true,
      data: true,
    },
  });
  const threadRows = await prisma.threads.findMany({
    where: { id: { in: visibleThreadIds } },
    select: { id: true, name: true },
  });
  const threadNameById = new Map(threadRows.map((row) => [row.id, row.name]));

  const posts: PostItem[] = [];
  for (const postId of effectivePostIds) {
    const rootsForPost = dedupMap.get(postId) ?? [];
    const canonicalRoot = rootsForPost[0];
    if (!canonicalRoot) continue;
    const sections: PostGroupSection[] = rootsForPost.map((root) => {
      const messageSet: MessageRow[] = descendants
        .filter(
          (m) =>
            m.id === root.id ||
            m.root_parent_id === root.id ||
            (m.parent_id === root.id && m.root_parent_id == null),
        )
        .map((m) => m as MessageRow);
      const sectionData = buildSectionData(messageSet, root.id, viewerUserId);
      const likeCount = Object.values(sectionData.likes ?? {}).filter(Boolean).length;
      return {
        id: root.id,
        thread_id: root.parent_id ?? "",
        thread_name: threadNameById.get(root.parent_id ?? "") ?? "Group",
        created_at: root.created_at.toISOString(),
        data: sectionData,
        like_count: likeCount,
        is_liked_by_viewer: Boolean(sectionData.likes?.[viewerUserId]),
      };
    });
    const hydratedSections = await hydrateCommentUsernames(sections);

    let imageGrant: string | null = null;
    if (canonicalRoot.image_id) {
      try {
        imageGrant = createMainBucketImageAccessGrant({
          imageId: canonicalRoot.image_id,
          storageUserId: canonicalRoot.created_by,
          viewerUserId,
        });
      } catch {}
    }
    let authorGrant: string | null = null;
    if (canonicalRoot.users.profile_image_id) {
      try {
        authorGrant = createMainBucketImageAccessGrant({
          imageId: canonicalRoot.users.profile_image_id,
          storageUserId: canonicalRoot.created_by,
          viewerUserId,
        });
      } catch {}
    }

    posts.push({
      id: postId,
      created_at: canonicalRoot.created_at.toISOString(),
      created_by: canonicalRoot.created_by,
      image_id: canonicalRoot.image_id,
      image_url: null,
      image_access_grant: imageGrant,
      text: canonicalRoot.text ?? "",
      data: hydratedSections[0]?.data ?? null,
      like_count: hydratedSections[0]?.like_count ?? 0,
      is_liked_by_viewer: hydratedSections[0]?.is_liked_by_viewer ?? false,
      username: canonicalRoot.users.username,
      email: canonicalRoot.users.email,
      author_profile_image_id: canonicalRoot.users.profile_image_id,
      author_profile_image_url: null,
      author_profile_image_access_grant: authorGrant,
      group_sections: hydratedSections,
    });
  }

  return {
    posts,
    hasMore,
    nextCursorPostId: posts.length > 0 ? posts[posts.length - 1]?.id ?? null : null,
  };
};
