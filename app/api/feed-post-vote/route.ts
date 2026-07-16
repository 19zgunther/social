import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { canViewerAccessPost } from "@/app/lib/postVisibility";
import { applyVote, MAX_OPTIONS, parsePollData, sanitizePostDataForViewer } from "@/app/lib/polls";
import { PostData } from "@/app/types/interfaces";

type FeedPostVoteBody = {
  post_id?: string;
  option_ids?: string[];
};

type VoteFailure = {
  status: 400 | 404;
  error: { code: string; message: string };
};

class VoteFailureError extends Error {
  readonly failure: VoteFailure;

  constructor(failure: VoteFailure) {
    super(failure.error.message);
    this.name = "VoteFailureError";
    this.failure = failure;
  }
}

const asPostDataObject = (value: Prisma.JsonValue | null): PostData => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as PostData;
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("feed_post_vote_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as FeedPostVoteBody;
    const postId = body.post_id?.trim();
    const optionIds = Array.isArray(body.option_ids) ? body.option_ids : null;
    if (!postId || !optionIds) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "post_id and option_ids are required." } },
        { status: 400 },
      );
    }
    if (optionIds.length > MAX_OPTIONS) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_vote",
            message: `Select at most ${MAX_OPTIONS} options.`,
          },
        },
        { status: 400 },
      );
    }

    const postMeta = await prisma.posts.findFirst({
      where: {
        id: postId,
      },
      select: {
        id: true,
        created_by: true,
        permanent: true,
      },
    });
    if (!postMeta) {
      return NextResponse.json(
        { error: { code: "post_not_found", message: "Post not found." } },
        { status: 404 },
      );
    }

    const allowed = await canViewerAccessPost({
      viewerUserId: authResult.user_id,
      post: postMeta,
    });
    if (!allowed) {
      return NextResponse.json(
        { error: { code: "not_allowed", message: "You cannot vote on this post." } },
        { status: 403 },
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      const lockedRows = await tx.$queryRaw<
        Array<{
          id: string;
          created_by: string;
          data: Prisma.JsonValue | null;
        }>
      >`
        SELECT id, created_by, data
        FROM posts
        WHERE id = ${postId}::uuid
        FOR UPDATE
      `;
      const post = lockedRows[0];
      if (!post) {
        throw new VoteFailureError({
          status: 404,
          error: { code: "post_not_found", message: "Post not found." },
        });
      }

      const dataObject = asPostDataObject(post.data);
      const poll = parsePollData(dataObject.poll);
      if (!poll) {
        throw new VoteFailureError({
          status: 400,
          error: { code: "not_a_poll", message: "This post is not a poll." },
        });
      }

      const voteResult = applyVote({
        poll,
        userId: authResult.user_id,
        optionIds,
      });
      if ("error" in voteResult) {
        throw new VoteFailureError({
          status: 400,
          error: voteResult.error,
        });
      }

      const nextData: Prisma.InputJsonValue = {
        ...dataObject,
        poll: voteResult.poll,
      } as Prisma.InputJsonValue;

      return tx.posts.update({
        where: {
          id: post.id,
        },
        data: {
          data: nextData,
        },
        select: {
          data: true,
          created_by: true,
        },
      });
    });

    const sanitizedData = sanitizePostDataForViewer({
      data: updated.data,
      viewerUserId: authResult.user_id,
      authorUserId: updated.created_by,
    });

    return NextResponse.json({ data: sanitizedData }, { status: 200 });
  } catch (error) {
    if (error instanceof VoteFailureError) {
      return NextResponse.json({ error: error.failure.error }, { status: error.failure.status });
    }
    console.error("feed_post_vote_failed", error);
    return NextResponse.json(
      { error: { code: "feed_post_vote_failed", message: "Failed to submit poll vote." } },
      { status: 500 },
    );
  }
}
