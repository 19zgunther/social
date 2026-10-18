import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import {
  buildTierListSubmissionBreakdown,
  parseTierListData,
} from "@/app/lib/tierLists";
import { canViewerAccessPost } from "@/app/lib/postVisibility";
import {
  FeedPostTierListSubmissionsRequest,
  FeedPostTierListSubmissionsResponse,
} from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("feed_post_tier_list_submissions_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as FeedPostTierListSubmissionsRequest;
    const postId = body.post_id?.trim();
    if (!postId) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "post_id is required." } },
        { status: 400 },
      );
    }

    const post = await prisma.posts.findFirst({
      where: { id: postId },
      select: {
        id: true,
        created_by: true,
        permanent: true,
        data: true,
      },
    });
    if (!post) {
      return NextResponse.json(
        { error: { code: "post_not_found", message: "Post not found." } },
        { status: 404 },
      );
    }

    const allowed = await canViewerAccessPost({
      viewerUserId: authResult.user_id,
      post,
    });
    if (!allowed) {
      return NextResponse.json(
        { error: { code: "not_allowed", message: "You cannot view this post." } },
        { status: 403 },
      );
    }

    const tierList = parseTierListData(
      post.data && typeof post.data === "object" && !Array.isArray(post.data)
        ? (post.data as Record<string, unknown>).tier_list
        : undefined,
    );
    if (!tierList) {
      return NextResponse.json(
        { error: { code: "not_a_tier_list", message: "This post is not a tier list." } },
        { status: 404 },
      );
    }

    if (!tierList.submissions[authResult.user_id]) {
      return NextResponse.json(
        {
          error: {
            code: "submission_required",
            message: "Submit your own tier list before viewing others.",
          },
        },
        { status: 400 },
      );
    }

    const breakdown = buildTierListSubmissionBreakdown(tierList);
    const userIds = breakdown.map((row) => row.user_id);
    const users =
      userIds.length > 0
        ? await prisma.users.findMany({
            where: { id: { in: userIds } },
            select: { id: true, username: true },
          })
        : [];
    const usernameById = new Map(users.map((user) => [user.id, user.username]));

    const payload: FeedPostTierListSubmissionsResponse = {
      tiers: tierList.tiers.map((tier) => ({ id: tier.id, name: tier.name })),
      options: tierList.options.map((option) => ({ id: option.id, text: option.text })),
      submissions: breakdown.map((row) => ({
        user_id: row.user_id,
        username: usernameById.get(row.user_id) ?? row.user_id,
        assignment: row.assignment,
      })),
    };

    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("feed_post_tier_list_submissions_failed", error);
    return NextResponse.json(
      {
        error: {
          code: "feed_post_tier_list_submissions_failed",
          message: "Failed to load tier list submissions.",
        },
      },
      { status: 500 },
    );
  }
}
