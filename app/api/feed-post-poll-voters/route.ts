import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import {
  buildClosedPollVoterBreakdown,
  isPollClosed,
  parsePollData,
} from "@/app/lib/polls";
import { canViewerAccessPost } from "@/app/lib/postVisibility";
import {
  FeedPostPollVotersRequest,
  FeedPostPollVotersResponse,
} from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("feed_post_poll_voters_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as FeedPostPollVotersRequest;
    const postId = body.post_id?.trim();
    if (!postId) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "post_id is required." } },
        { status: 400 },
      );
    }

    const post = await prisma.posts.findFirst({
      where: {
        id: postId,
      },
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

    const poll = parsePollData(
      post.data && typeof post.data === "object" && !Array.isArray(post.data)
        ? (post.data as Record<string, unknown>).poll
        : undefined,
    );
    if (!poll) {
      return NextResponse.json(
        { error: { code: "not_a_poll", message: "This post is not a poll." } },
        { status: 404 },
      );
    }
    if (!isPollClosed(poll)) {
      return NextResponse.json(
        {
          error: {
            code: "poll_not_closed",
            message: "Voter lists are only available after the poll closes.",
          },
        },
        { status: 400 },
      );
    }

    const breakdown = buildClosedPollVoterBreakdown(poll);
    const voterIds = Array.from(
      new Set(breakdown.flatMap((row) => row.voter_ids)),
    );
    const users =
      voterIds.length > 0
        ? await prisma.users.findMany({
            where: { id: { in: voterIds } },
            select: { id: true, username: true },
          })
        : [];
    const usernameById = new Map(users.map((user) => [user.id, user.username]));

    const payload: FeedPostPollVotersResponse = {
      options: breakdown.map((row) => ({
        option_id: row.option_id,
        text: row.text,
        voters: row.voter_ids.map((userId) => ({
          user_id: userId,
          username: usernameById.get(userId) ?? userId,
        })),
      })),
    };

    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("feed_post_poll_voters_failed", error);
    return NextResponse.json(
      {
        error: {
          code: "feed_post_poll_voters_failed",
          message: "Failed to load poll voters.",
        },
      },
      { status: 500 },
    );
  }
}
