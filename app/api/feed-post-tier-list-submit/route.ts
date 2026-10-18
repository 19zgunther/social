import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { canViewerAccessPost } from "@/app/lib/postVisibility";
import { sanitizePostDataForViewer } from "@/app/lib/polls";
import {
  applyTierListSubmission,
  MAX_OPTIONS,
  parseTierListData,
} from "@/app/lib/tierLists";
import { FeedPostTierListSubmitRequest, PostData } from "@/app/types/interfaces";

type SubmitFailure = {
  status: 400 | 404;
  error: { code: string; message: string };
};

class SubmitFailureError extends Error {
  readonly failure: SubmitFailure;

  constructor(failure: SubmitFailure) {
    super(failure.error.message);
    this.name = "SubmitFailureError";
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
    console.error("feed_post_tier_list_submit_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as FeedPostTierListSubmitRequest;
    const postId = body.post_id?.trim();
    const assignment =
      body.assignment && typeof body.assignment === "object" && !Array.isArray(body.assignment)
        ? body.assignment
        : null;
    if (!postId || !assignment) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "post_id and assignment are required.",
          },
        },
        { status: 400 },
      );
    }
    if (Object.keys(assignment).length > MAX_OPTIONS) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_submission",
            message: `Assign at most ${MAX_OPTIONS} options.`,
          },
        },
        { status: 400 },
      );
    }

    const postMeta = await prisma.posts.findFirst({
      where: { id: postId },
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
        {
          error: {
            code: "not_allowed",
            message: "You cannot submit on this post.",
          },
        },
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
        throw new SubmitFailureError({
          status: 404,
          error: { code: "post_not_found", message: "Post not found." },
        });
      }

      const dataObject = asPostDataObject(post.data);
      const tierList = parseTierListData(dataObject.tier_list);
      if (!tierList) {
        throw new SubmitFailureError({
          status: 400,
          error: { code: "not_a_tier_list", message: "This post is not a tier list." },
        });
      }

      const submitResult = applyTierListSubmission({
        tierList,
        userId: authResult.user_id,
        assignment,
      });
      if ("error" in submitResult) {
        throw new SubmitFailureError({
          status: 400,
          error: submitResult.error,
        });
      }

      const nextData: Prisma.InputJsonValue = {
        ...dataObject,
        tier_list: submitResult.tierList,
      } as Prisma.InputJsonValue;

      return tx.posts.update({
        where: { id: post.id },
        data: { data: nextData },
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
    if (error instanceof SubmitFailureError) {
      return NextResponse.json({ error: error.failure.error }, { status: error.failure.status });
    }
    console.error("feed_post_tier_list_submit_failed", error);
    return NextResponse.json(
      {
        error: {
          code: "feed_post_tier_list_submit_failed",
          message: "Failed to submit tier list.",
        },
      },
      { status: 500 },
    );
  }
}
