import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { createMainBucketImageAccessGrant } from "@/app/api/image_access_grant";
import { PostData, PostItem } from "@/app/types/interfaces";

const PAGE_SIZE = 24;

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
    console.error("user_profile_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      user_id?: string;
      cursor_post_id?: string;
    };
    const targetUserId = body.user_id?.trim();
    const cursorPostId = body.cursor_post_id?.trim();

    if (!targetUserId) {
      return NextResponse.json(
        { error: { code: "missing_user_id", message: "User ID is required." } },
        { status: 400 },
      );
    }

    const targetUser = await prisma.users.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        username: true,
        email: true,
        profile_image_id: true,
      },
    });

    if (!targetUser) {
      return NextResponse.json(
        { error: { code: "user_not_found", message: "User not found." } },
        { status: 404 },
      );
    }

    const friendshipRow = await prisma.friends.findFirst({
      where: {
        OR: [
          {
            requesting_user: authResult.user_id,
            other_user: targetUserId,
          },
          {
            other_user: authResult.user_id,
            requesting_user: targetUserId,
          },
        ],
      },
      select: {
        id: true,
        requesting_user: true,
        other_user: true,
        accepted: true,
      },
    });

    let friendshipStatus: "none" | "friends" | "pending_sent" | "pending_received" | "rejected" = "none";
    let friendshipId: string | null = null;

    if (friendshipRow) {
      friendshipId = friendshipRow.id;
      if (friendshipRow.accepted === true) {
        friendshipStatus = "friends";
      } else if (friendshipRow.accepted === false) {
        friendshipStatus = "rejected";
      } else if (friendshipRow.requesting_user === authResult.user_id) {
        friendshipStatus = "pending_sent";
      } else {
        friendshipStatus = "pending_received";
      }
    }

    const isFriends = friendshipStatus === "friends";

    let profileImageAccessGrant: string | null = null;
    if (isFriends && targetUser.profile_image_id) {
      try {
        profileImageAccessGrant = createMainBucketImageAccessGrant({
          imageId: targetUser.profile_image_id,
          storageUserId: targetUserId,
          viewerUserId: authResult.user_id,
        });
      } catch (error) {
        console.error("user_profile_image_grant_failed", targetUserId, error);
      }
    }

    let posts: PostItem[] = [];
    let hasMore = false;
    let nextCursorPostId: string | null = null;

    if (isFriends) {
      const postsDesc = await prisma.posts.findMany({
        where: {
          created_by: targetUserId,
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

      hasMore = postsDesc.length > PAGE_SIZE;
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
          console.error("user_profile_post_image_grant_failed", post.id, error);
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
          console.error("user_profile_post_author_profile_image_grant_failed", post.id, error);
          return [post.id, null] as const;
        }
      });
      const authorProfileImageAccessGrantByPostId = new Map(authorProfileImageGrantEntries);

      posts = pagedPosts.map((post) => ({
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
      }));

      nextCursorPostId = pagedPosts.length > 0 ? pagedPosts[pagedPosts.length - 1].id : null;
    }

    const payload = {
      user: {
        id: targetUser.id,
        username: targetUser.username,
        profile_image_id: targetUser.profile_image_id,
        profile_image_url: null,
        profile_image_access_grant: profileImageAccessGrant,
      },
      friendship_status: friendshipStatus,
      friendship_id: friendshipId,
      posts,
      has_more: hasMore,
      next_cursor_post_id: nextCursorPostId,
    };

    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("user_profile_failed", error);
    return NextResponse.json(
      { error: { code: "user_profile_failed", message: "Failed to load user profile." } },
      { status: 500 },
    );
  }
}
