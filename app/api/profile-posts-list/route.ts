import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { createMainBucketImageAccessGrant } from "@/app/api/image_access_grant";
import { getPostCoverObject } from "@/app/lib/postMedia";
import { sanitizePostDataForViewer } from "@/app/lib/polls";
import {
  PostData,
  ProfilePostsListRequest,
  ProfilePostsListResponse,
} from "@/app/types/interfaces";

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
    console.error("profile_posts_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ProfilePostsListRequest;
    const cursorPostId = body.cursor_post_id?.trim();

    const postsDesc = await prisma.posts.findMany({
      where: {
        created_by: authResult.user_id,
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
    const pagedPosts = postsDesc.slice(0, PAGE_SIZE);

    const mintGrant = (
      imageId: string | null | undefined,
      storageUserId: string,
    ): string | null => {
      if (!imageId) {
        return null;
      }
      try {
        return createMainBucketImageAccessGrant({
          imageId,
          storageUserId,
          viewerUserId: authResult.user_id,
        });
      } catch (error) {
        console.error("profile_post_image_grant_failed", imageId, error);
        return null;
      }
    };

    const payload: ProfilePostsListResponse = {
      has_more: hasMore,
      next_cursor_post_id: pagedPosts.length > 0 ? pagedPosts[pagedPosts.length - 1].id : null,
      posts: pagedPosts.map((post) => {
        const likesInfo = getLikesInfo(post.data, authResult.user_id);
        const data = sanitizePostDataForViewer({
          data: post.data,
          viewerUserId: authResult.user_id,
          authorUserId: post.created_by,
        });
        const cover = getPostCoverObject(data);
        return {
          like_count: likesInfo.likeCount,
          is_liked_by_viewer: likesInfo.isLikedByViewer,
          id: post.id,
          created_at: post.created_at.toISOString(),
          created_by: post.created_by,
          text: post.text ?? "",
          data,
          cover_image_id: cover?.objectId ?? null,
          cover_image_access_grant: mintGrant(
            cover?.objectId,
            cover?.ownerUserId ?? post.created_by,
          ),
          username: post.users.username,
          email: post.users.email,
          is_bot: post.users.bots_bots_user_idTousers.length > 0,
          viewer_can_delete: true,
          author_profile_image_id: post.users.profile_image_id,
          author_profile_image_url: null,
          author_profile_image_access_grant: mintGrant(
            post.users.profile_image_id,
            post.created_by,
          ),
        };
      }),
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("profile_posts_failed", error);
    return NextResponse.json(
      { error: { code: "profile_posts_failed", message: "Failed to load profile posts." } },
      { status: 500 },
    );
  }
}
