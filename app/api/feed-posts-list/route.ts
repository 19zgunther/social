import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { getSignedMainBucketImageUrl } from "@/app/api/server_file_storage_utils";

type FeedPostsBody = {
  cursor_post_id?: string;
};

const PAGE_SIZE = 10;

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("feed_posts_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as FeedPostsBody;
    const cursorPostId = body.cursor_post_id?.trim();

    const postsDesc = await prisma.posts.findMany({
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
          console.error("feed_post_image_sign_failed", post.id, error);
          return [post.id, null] as const;
        }
      }),
    );
    const imageUrlByPostId = new Map(signedUrlEntries);

    return NextResponse.json(
      {
        has_more: hasMore,
        next_cursor_post_id: pagedPosts.length > 0 ? pagedPosts[pagedPosts.length - 1].id : null,
        posts: pagedPosts.map((post) => ({
          id: post.id,
          created_at: post.created_at,
          created_by: post.created_by,
          image_id: post.image_id,
          image_url: imageUrlByPostId.get(post.id) ?? null,
          text: post.text ?? "",
          data: post.data,
          username: post.users.username,
          email: post.users.email,
        })),
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("feed_posts_failed", error);
    return NextResponse.json(
      { error: { code: "feed_posts_failed", message: "Failed to load feed posts." } },
      { status: 500 },
    );
  }
}
