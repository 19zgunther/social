import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { loadAcceptedFriendIds } from "@/app/lib/acceptedFriendIds";
import {
  getSharedPostPhase,
  serializeSharedPostListItem,
  sharedPostSelectForSerialize,
} from "@/app/lib/sharedPosts";
import type { SharedPostInviteRequest, SharedPostInviteResponse } from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("shared_post_invite_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as SharedPostInviteRequest;
    const sharedPostId = body.shared_post_id?.trim() ?? "";
    const inviteeUserIds = Array.from(
      new Set((body.invitee_user_ids ?? []).map((id) => id.trim()).filter(Boolean)),
    ).filter((id) => id !== authResult.user_id);

    if (!sharedPostId || inviteeUserIds.length === 0) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "shared_post_id and invitee_user_ids are required.",
          },
        },
        { status: 400 },
      );
    }

    const existing = await prisma.shared_posts.findFirst({
      where: { id: sharedPostId },
      select: {
        id: true,
        created_by: true,
        close_at: true,
        release_at: true,
        shared_posts_contributors: {
          select: { user_id: true },
        },
      },
    });
    if (!existing) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Shared post not found." } },
        { status: 404 },
      );
    }
    if (existing.created_by !== authResult.user_id) {
      return NextResponse.json(
        { error: { code: "not_allowed", message: "Only the creator can invite people." } },
        { status: 403 },
      );
    }
    if (getSharedPostPhase(existing.close_at, existing.release_at) !== "open") {
      return NextResponse.json(
        { error: { code: "closed", message: "Invites are only allowed while the post is open." } },
        { status: 400 },
      );
    }

    const alreadyInvited = new Set(existing.shared_posts_contributors.map((row) => row.user_id));
    const toInvite = inviteeUserIds.filter((id) => !alreadyInvited.has(id));
    if (toInvite.length === 0) {
      const refreshed = await prisma.shared_posts.findFirst({
        where: { id: sharedPostId },
        select: sharedPostSelectForSerialize,
      });
      if (!refreshed) {
        return NextResponse.json(
          { error: { code: "not_found", message: "Shared post not found." } },
          { status: 404 },
        );
      }
      const payload: SharedPostInviteResponse = {
        shared_post: serializeSharedPostListItem({
          row: refreshed,
          viewerUserId: authResult.user_id,
          includeContributors: true,
        }),
      };
      return NextResponse.json(payload, { status: 200 });
    }

    const friendIds = await loadAcceptedFriendIds(authResult.user_id);
    const nonFriends = toInvite.filter((id) => !friendIds.has(id));
    if (nonFriends.length > 0) {
      return NextResponse.json(
        {
          error: {
            code: "invitees_not_friends",
            message: "You can only invite accepted friends.",
          },
        },
        { status: 400 },
      );
    }

    const existingUsers = await prisma.users.findMany({
      where: { id: { in: toInvite } },
      select: { id: true },
    });
    if (existingUsers.length !== toInvite.length) {
      return NextResponse.json(
        { error: { code: "invitee_not_found", message: "One or more invitees were not found." } },
        { status: 400 },
      );
    }

    const invitedAt = new Date();
    await prisma.shared_posts_contributors.createMany({
      data: toInvite.map((userId) => ({
        shared_post_id: sharedPostId,
        user_id: userId,
        invited_at: invitedAt,
        invited_by: authResult.user_id,
      })),
      skipDuplicates: true,
    });

    const refreshed = await prisma.shared_posts.findFirst({
      where: { id: sharedPostId },
      select: sharedPostSelectForSerialize,
    });
    if (!refreshed) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Shared post not found." } },
        { status: 404 },
      );
    }

    const payload: SharedPostInviteResponse = {
      shared_post: serializeSharedPostListItem({
        row: refreshed,
        viewerUserId: authResult.user_id,
        includeContributors: true,
      }),
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("shared_post_invite_failed", error);
    return NextResponse.json(
      { error: { code: "shared_post_invite_failed", message: "Failed to invite users." } },
      { status: 500 },
    );
  }
}
