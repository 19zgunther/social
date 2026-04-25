import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import {
  ProfilePostsListRequest,
  ProfilePostsListResponse,
} from "@/app/types/interfaces";
import { getAccessibleThreadIds, listThreadBackedPosts } from "@/app/api/post_thread_utils";

const PAGE_SIZE = 24;

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("profile_posts_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ProfilePostsListRequest;
    const cursorPostId = body.cursor_post_id?.trim();

    const visibleThreadIds = await getAccessibleThreadIds(authResult.user_id);
    const { posts, hasMore, nextCursorPostId } = await listThreadBackedPosts({
      viewerUserId: authResult.user_id,
      visibleThreadIds,
      authorUserIds: [authResult.user_id],
      cursorPostId,
      pageSize: PAGE_SIZE,
    });

    const payload: ProfilePostsListResponse = {
      has_more: hasMore,
      next_cursor_post_id: nextCursorPostId,
      posts,
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
