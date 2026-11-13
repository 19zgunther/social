import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { createMainBucketImageAccessGrant } from "@/app/api/image_access_grant";
import { getPostCoverObject } from "@/app/lib/postMedia";
import { resolveStorageBackends, type StorageBackend } from "@/app/lib/storageObjects";
import { visiblePostsWhereForViewer } from "@/app/lib/postVisibility";
import { sanitizePostDataForViewer } from "@/app/lib/polls";
import {
  FeedPostsListRequest,
  FeedPostsListResponse,
  PostData,
  PostItem,
} from "@/app/types/interfaces";

const PAGE_SIZE = 10;

const getLikesInfo = (rawData: unknown, viewerUserId: string): { likeCount: number; isLikedByViewer: boolean } => {
  const data = rawData && typeof rawData === "object" && !Array.isArray(rawData) ? (rawData as PostData) : {};
  const likes = data.likes ?? {};
  const likeCount = Object.values(likes).filter(Boolean).length;
  const isLikedByViewer = Boolean(likes[viewerUserId]);
  return { likeCount, isLikedByViewer };
};

const mintGrant = (
  imageId: string | null | undefined,
  storageUserId: string,
  viewerUserId: string,
  backends: Map<string, StorageBackend>,
): string | null => {
  if (!imageId) {
    return null;
  }
  try {
    return createMainBucketImageAccessGrant({
      imageId,
      storageUserId,
      viewerUserId,
      backend: backends.get(imageId) ?? "supabase",
    });
  } catch (error) {
    console.error("feed_image_grant_failed", imageId, error);
    return null;
  }
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("feed_posts_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as FeedPostsListRequest;
    const cursorAtRaw = body.cursor?.trim() || body.cursor_post_id?.trim();
    // Prefer opaque ISO sort cursor; legacy cursor_post_id alone can't recover sort time, so ignore bare ids.
    const cursorAt =
      cursorAtRaw && !Number.isNaN(Date.parse(cursorAtRaw)) ? new Date(cursorAtRaw) : null;

    const acceptedFriendRows = await prisma.friends.findMany({
      where: {
        accepted: true,
        OR: [{ requesting_user: authResult.user_id }, { other_user: authResult.user_id }],
      },
      select: {
        requesting_user: true,
        other_user: true,
      },
    });
    const friendUserIds = Array.from(
      new Set(
        acceptedFriendRows.map((row) =>
          row.requesting_user === authResult.user_id ? row.other_user : row.requesting_user,
        ),
      ),
    );

    const postsDesc = await prisma.posts.findMany({
      where: {
        AND: [
          visiblePostsWhereForViewer(authResult.user_id, friendUserIds),
          ...(cursorAt ? [{ created_at: { lt: cursorAt } }] : []),
        ],
      },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      take: PAGE_SIZE + 1,
      select: {
        id: true,
        created_at: true,
        created_by: true,
        text: true,
        data: true,
        users: {
          select: {
            username: true,
            email: true,
            profile_image_id: true,
            bots_bots_user_idTousers: {
              select: { id: true, owner_id: true },
              take: 1,
            },
          },
        },
      },
    });

    const hasMore = postsDesc.length > PAGE_SIZE;
    const paged = postsDesc.slice(0, PAGE_SIZE);
    const last = paged[paged.length - 1] ?? null;

    const sanitizedPosts = paged.map((post) => {
      const data = sanitizePostDataForViewer({
        data: post.data,
        viewerUserId: authResult.user_id,
        authorUserId: post.created_by,
      });
      return { post, data, cover: getPostCoverObject(data) };
    });
    const backends = await resolveStorageBackends(
      sanitizedPosts.flatMap(({ post, cover }) => [cover?.objectId, post.users.profile_image_id]),
    );

    const posts: PostItem[] = sanitizedPosts.map(({ post, data, cover }) => {
      const likesInfo = getLikesInfo(post.data, authResult.user_id);
      const coverStorageUserId = cover?.ownerUserId ?? post.created_by;
      return {
        id: post.id,
        created_at: post.created_at.toISOString(),
        created_by: post.created_by,
        text: post.text ?? "",
        data,
        cover_image_id: cover?.objectId ?? null,
        cover_image_access_grant: mintGrant(
          cover?.objectId,
          coverStorageUserId,
          authResult.user_id,
          backends,
        ),
        like_count: likesInfo.likeCount,
        is_liked_by_viewer: likesInfo.isLikedByViewer,
        username: post.users.username,
        email: post.users.email,
        is_bot: post.users.bots_bots_user_idTousers.length > 0,
        viewer_can_delete:
          post.created_by === authResult.user_id ||
          post.users.bots_bots_user_idTousers.some((bot) => bot.owner_id === authResult.user_id),
        author_profile_image_id: post.users.profile_image_id,
        author_profile_image_url: null,
        author_profile_image_access_grant: mintGrant(
          post.users.profile_image_id,
          post.created_by,
          authResult.user_id,
          backends,
        ),
      };
    });

    const payload: FeedPostsListResponse = {
      viewer_user_id: authResult.user_id,
      has_more: hasMore,
      next_cursor: last ? last.created_at.toISOString() : null,
      next_cursor_post_id: last?.id ?? null,
      posts,
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("feed_posts_failed", error);
    return NextResponse.json(
      { error: { code: "feed_posts_failed", message: "Failed to load feed posts." } },
      { status: 500 },
    );
  }
}
