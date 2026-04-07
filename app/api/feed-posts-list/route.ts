import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { createMainBucketImageAccessGrant } from "@/app/api/image_access_grant";
import {
  FeedPostsListRequest,
  FeedPostsListResponse,
  PostData,
} from "@/app/types/interfaces";

const PAGE_SIZE = 10;

const getLikesInfo = (rawData: unknown, viewerUserId: string): { likeCount: number; isLikedByViewer: boolean } => {
  const data = rawData && typeof rawData === "object" && !Array.isArray(rawData) ? (rawData as PostData) : {};
  const likes = data.likes ?? {};
  const likeCount = Object.values(likes).filter(Boolean).length;
  const isLikedByViewer = Boolean(likes[viewerUserId]);
  return { likeCount, isLikedByViewer };
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("feed_posts_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as FeedPostsListRequest;
    const cursorPostId = body.cursor_post_id?.trim();
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
    const visibleUserIds = Array.from(new Set([authResult.user_id, ...friendUserIds]));
    if (visibleUserIds.length === 0) {
      const payload: FeedPostsListResponse = {
        has_more: false,
        next_cursor_post_id: null,
        posts: [],
      };
      return NextResponse.json(payload, { status: 200 });
    }

    const postsDesc = await prisma.posts.findMany({
      where: {
        created_by: {
          in: visibleUserIds,
        },
      },
      ...(cursorPostId
        ? {
            cursor: {
              id: cursorPostId,
            },
            skip: 1,
          }
        : {}),
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
    });

    const hasMore = postsDesc.length > PAGE_SIZE;
    const pagedPosts = postsDesc.slice(0, PAGE_SIZE);

    const postImageGrantEntries = pagedPosts.map((post) => {
      if (!post.image_id) {
        return [post.id, null] as const;
      }
      try {
        const grant = createMainBucketImageAccessGrant({
          imageId: post.image_id,
          storageUserId: post.created_by,
          viewerUserId: authResult.user_id,
        });
        return [post.id, grant] as const;
      } catch (error) {
        console.error("feed_post_image_grant_failed", post.id, error);
        return [post.id, null] as const;
      }
    });
    const imageAccessGrantByPostId = new Map(postImageGrantEntries);

    const authorProfileImageGrantEntries = pagedPosts.map((post) => {
      if (!post.users.profile_image_id) {
        return [post.id, null] as const;
      }
      try {
        const grant = createMainBucketImageAccessGrant({
          imageId: post.users.profile_image_id,
          storageUserId: post.created_by,
          viewerUserId: authResult.user_id,
        });
        return [post.id, grant] as const;
      } catch (error) {
        console.error("feed_post_author_profile_image_grant_failed", post.id, error);
        return [post.id, null] as const;
      }
    });
    const authorProfileImageAccessGrantByPostId = new Map(authorProfileImageGrantEntries);

    const payload: FeedPostsListResponse = {
      viewer_user_id: authResult.user_id,
      has_more: hasMore,
      next_cursor_post_id: pagedPosts.length > 0 ? pagedPosts[pagedPosts.length - 1].id : null,
      posts: pagedPosts.map((post) => ({
        ...(() => {
          const likesInfo = getLikesInfo(post.data, authResult.user_id);
          return {
            like_count: likesInfo.likeCount,
            is_liked_by_viewer: likesInfo.isLikedByViewer,
          };
        })(),
        id: post.id,
        created_at: post.created_at.toISOString(),
        created_by: post.created_by,
        image_id: post.image_id,
        image_url: null,
        image_access_grant: imageAccessGrantByPostId.get(post.id) ?? null,
        text: post.text ?? "",
        data: post.data as PostData | null,
        username: post.users.username,
        email: post.users.email,
        author_profile_image_id: post.users.profile_image_id,
        author_profile_image_url: null,
        author_profile_image_access_grant:
          authorProfileImageAccessGrantByPostId.get(post.id) ?? null,
      })),
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
