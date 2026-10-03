import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { createMainBucketImageAccessGrant } from "@/app/api/image_access_grant";
import { visiblePostsWhereForViewer } from "@/app/lib/postVisibility";
import { sanitizePostDataForViewer } from "@/app/lib/polls";
import {
  asSharedPostDataObject,
  findSharedMediaOwnerUserId,
} from "@/app/lib/sharedPosts";
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
): string | null => {
  if (!imageId) {
    return null;
  }
  try {
    return createMainBucketImageAccessGrant({ imageId, storageUserId, viewerUserId });
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

    const now = new Date();
    const [postsDesc, sharedDesc] = await Promise.all([
      prisma.posts.findMany({
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
          image_id: true,
          text: true,
          data: true,
          users: {
            select: {
              username: true,
              email: true,
              profile_image_id: true,
            },
          },
        },
      }),
      prisma.shared_posts.findMany({
        where: {
          AND: [
            { release_at: { lte: now } },
            ...(cursorAt ? [{ release_at: { lt: cursorAt } }] : []),
            {
              shared_posts_contributors: {
                some: { user_id: authResult.user_id },
              },
            },
          ],
        },
        orderBy: [{ release_at: "desc" }, { id: "desc" }],
        take: PAGE_SIZE + 1,
        select: {
          id: true,
          created_by: true,
          title: true,
          text: true,
          image_id: true,
          data: true,
          close_at: true,
          release_at: true,
          users: {
            select: {
              username: true,
              email: true,
              profile_image_id: true,
            },
          },
        },
      }),
    ]);

    const merged: Array<{ sortAt: Date; item: PostItem }> = [
      ...postsDesc.map((post) => {
        const likesInfo = getLikesInfo(post.data, authResult.user_id);
        return {
          sortAt: post.created_at,
          item: {
            kind: "post" as const,
            id: post.id,
            created_at: post.created_at.toISOString(),
            created_by: post.created_by,
            image_id: post.image_id,
            image_url: null,
            image_access_grant: mintGrant(post.image_id, post.created_by, authResult.user_id),
            text: post.text ?? "",
            data: sanitizePostDataForViewer({
              data: post.data,
              viewerUserId: authResult.user_id,
              authorUserId: post.created_by,
            }),
            like_count: likesInfo.likeCount,
            is_liked_by_viewer: likesInfo.isLikedByViewer,
            username: post.users.username,
            email: post.users.email,
            author_profile_image_id: post.users.profile_image_id,
            author_profile_image_url: null,
            author_profile_image_access_grant: mintGrant(
              post.users.profile_image_id,
              post.created_by,
              authResult.user_id,
            ),
          },
        };
      }),
      ...sharedDesc.map((shared) => {
        const likesInfo = getLikesInfo(shared.data, authResult.user_id);
        const imageOwner =
          findSharedMediaOwnerUserId(asSharedPostDataObject(shared.data), shared.image_id ?? "") ??
          shared.created_by;
        return {
          sortAt: shared.release_at,
          item: {
            kind: "shared_event" as const,
            id: shared.id,
            shared_post_id: shared.id,
            title: shared.title,
            close_at: shared.close_at.toISOString(),
            release_at: shared.release_at.toISOString(),
            created_at: shared.release_at.toISOString(),
            created_by: shared.created_by,
            image_id: shared.image_id,
            image_url: null,
            image_access_grant: mintGrant(shared.image_id, imageOwner, authResult.user_id),
            text: shared.text ?? "",
            data: sanitizePostDataForViewer({
              data: shared.data,
              viewerUserId: authResult.user_id,
              authorUserId: shared.created_by,
            }),
            like_count: likesInfo.likeCount,
            is_liked_by_viewer: likesInfo.isLikedByViewer,
            username: shared.users.username,
            email: shared.users.email,
            author_profile_image_id: shared.users.profile_image_id,
            author_profile_image_url: null,
            author_profile_image_access_grant: mintGrant(
              shared.users.profile_image_id,
              shared.created_by,
              authResult.user_id,
            ),
          },
        };
      }),
    ];

    merged.sort((a, b) => b.sortAt.getTime() - a.sortAt.getTime());
    const hasMore = merged.length > PAGE_SIZE;
    const paged = merged.slice(0, PAGE_SIZE);
    const last = paged[paged.length - 1] ?? null;

    const payload: FeedPostsListResponse = {
      viewer_user_id: authResult.user_id,
      has_more: hasMore,
      next_cursor: last ? last.sortAt.toISOString() : null,
      next_cursor_post_id: last?.item.id ?? null,
      posts: paged.map((row) => row.item),
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
