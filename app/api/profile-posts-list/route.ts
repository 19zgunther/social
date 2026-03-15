import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { getSignedMainBucketImageUrl } from "@/app/api/server_file_storage_utils";

type ProfilePostsBody = {
  cursor_post_id?: string;
};

const PAGE_SIZE = 24;

type PostData = {
  likes?: Record<string, boolean>;
};

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
    const body = (await request.json()) as ProfilePostsBody;
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

    const signedUrlEntries = await Promise.all(
      pagedPosts.map(async (post) => {
        if (!post.image_id) {
          return [post.id, null] as const;
        }
        try {
          const signedUrl = await getSignedMainBucketImageUrl({
            userId: post.created_by,
            imageId: post.image_id,
          });
          return [post.id, signedUrl] as const;
        } catch (error) {
          console.error("profile_post_image_sign_failed", post.id, error);
          return [post.id, null] as const;
        }
      }),
    );
    const imageUrlByPostId = new Map(signedUrlEntries);

    const authorProfileImageUrlEntries = await Promise.all(
      pagedPosts.map(async (post) => {
        if (!post.users.profile_image_id) {
          return [post.id, null] as const;
        }
        try {
          const signedUrl = await getSignedMainBucketImageUrl({
            userId: post.created_by,
            imageId: post.users.profile_image_id,
          });
          return [post.id, signedUrl] as const;
        } catch (error) {
          console.error("profile_post_author_profile_image_sign_failed", post.id, error);
          return [post.id, null] as const;
        }
      }),
    );
    const authorProfileImageUrlByPostId = new Map(authorProfileImageUrlEntries);

    return NextResponse.json(
      {
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
          created_at: post.created_at,
          created_by: post.created_by,
          image_id: post.image_id,
          image_url: imageUrlByPostId.get(post.id) ?? null,
          text: post.text ?? "",
          data: post.data,
          username: post.users.username,
          email: post.users.email,
          author_profile_image_url: authorProfileImageUrlByPostId.get(post.id) ?? null,
        })),
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("profile_posts_failed", error);
    return NextResponse.json(
      { error: { code: "profile_posts_failed", message: "Failed to load profile posts." } },
      { status: 500 },
    );
  }
}
