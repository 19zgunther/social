import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import {
  FeedPostsListRequest,
  FeedPostsListResponse,
} from "@/app/types/interfaces";
import { getAccessibleThreadIds, listThreadBackedPosts } from "@/app/api/post_thread_utils";

const PAGE_SIZE = 10;

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("feed_posts_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as FeedPostsListRequest;
    const cursorPostId = body.cursor_post_id?.trim();
    const visibleThreadIds = await getAccessibleThreadIds(authResult.user_id);
    const { posts, hasMore, nextCursorPostId } = await listThreadBackedPosts({
      viewerUserId: authResult.user_id,
      visibleThreadIds,
      cursorPostId,
      pageSize: PAGE_SIZE,
    });

    const payload: FeedPostsListResponse = {
      viewer_user_id: authResult.user_id,
      has_more: hasMore,
      next_cursor_post_id: nextCursorPostId,
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
