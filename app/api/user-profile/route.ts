import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { createMainBucketImageAccessGrant } from "@/app/api/image_access_grant";
import { PostItem, UserProfileRequest } from "@/app/types/interfaces";
import { getSharedThreadIds, listThreadBackedPosts } from "@/app/api/post_thread_utils";

const PAGE_SIZE = 24;

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("user_profile_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as UserProfileRequest;
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
      const sharedThreadIds = await getSharedThreadIds(authResult.user_id, targetUserId);
      const postList = await listThreadBackedPosts({
        viewerUserId: authResult.user_id,
        visibleThreadIds: sharedThreadIds,
        authorUserIds: [targetUserId],
        cursorPostId,
        pageSize: PAGE_SIZE,
      });
      posts = postList.posts;
      hasMore = postList.hasMore;
      nextCursorPostId = postList.nextCursorPostId;
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
