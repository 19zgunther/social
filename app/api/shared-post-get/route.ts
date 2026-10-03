import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import {
  serializeSharedPostListItem,
  sharedPostSelectForSerialize,
} from "@/app/lib/sharedPosts";
import type { SharedPostGetRequest, SharedPostGetResponse } from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("shared_post_get_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as SharedPostGetRequest;
    const sharedPostId = body.shared_post_id?.trim() ?? "";
    if (!sharedPostId) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "shared_post_id is required." } },
        { status: 400 },
      );
    }

    const row = await prisma.shared_posts.findFirst({
      where: {
        id: sharedPostId,
        shared_posts_contributors: {
          some: { user_id: authResult.user_id },
        },
      },
      select: sharedPostSelectForSerialize,
    });
    if (!row) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Shared post not found." } },
        { status: 404 },
      );
    }

    const payload: SharedPostGetResponse = {
      shared_post: serializeSharedPostListItem({
        row,
        viewerUserId: authResult.user_id,
        includeContributors: true,
      }),
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("shared_post_get_failed", error);
    return NextResponse.json(
      { error: { code: "shared_post_get_failed", message: "Failed to load shared post." } },
      { status: 500 },
    );
  }
}
