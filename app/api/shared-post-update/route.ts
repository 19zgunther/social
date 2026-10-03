import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { loadAcceptedFriendIds } from "@/app/lib/acceptedFriendIds";
import {
  asSharedPostDataObject,
  serializeSharedPostListItem,
  sharedPostSelectForSerialize,
  stripMediaForRemovedContributors,
  validateSharedPostDates,
} from "@/app/lib/sharedPosts";
import type { SharedPostUpdateRequest, SharedPostUpdateResponse } from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("shared_post_update_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as SharedPostUpdateRequest;
    const sharedPostId = body.shared_post_id?.trim() ?? "";
    const title = body.title?.trim() ?? "";
    const text = body.text?.trim() || null;
    const closeAtRaw = body.close_at?.trim() ?? "";
    const releaseAtRaw = body.release_at?.trim() ?? "";
    const inviteeUserIds = Array.from(
      new Set((body.invitee_user_ids ?? []).map((id) => id.trim()).filter(Boolean)),
    ).filter((id) => id !== authResult.user_id);

    if (!sharedPostId) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "shared_post_id is required." } },
        { status: 400 },
      );
    }
    if (!title) {
      return NextResponse.json(
        { error: { code: "invalid_title", message: "title is required." } },
        { status: 400 },
      );
    }
    if (!closeAtRaw || !releaseAtRaw) {
      return NextResponse.json(
        { error: { code: "invalid_dates", message: "close_at and release_at are required." } },
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
        data: true,
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
        { error: { code: "not_allowed", message: "Only the creator can edit this shared post." } },
        { status: 403 },
      );
    }

    const closeAt = new Date(closeAtRaw);
    const releaseAt = new Date(releaseAtRaw);
    const datesOk = validateSharedPostDates(closeAt, releaseAt);
    if (!datesOk.ok) {
      return NextResponse.json(
        { error: { code: datesOk.code, message: datesOk.message } },
        { status: 400 },
      );
    }

    const alreadyInvited = new Set(
      existing.shared_posts_contributors
        .map((row) => row.user_id)
        .filter((userId) => userId !== authResult.user_id),
    );
    const nextInviteeSet = new Set(inviteeUserIds);
    const toInvite = inviteeUserIds.filter((id) => !alreadyInvited.has(id));
    const toRemove = Array.from(alreadyInvited).filter((id) => !nextInviteeSet.has(id));

    if (toInvite.length > 0) {
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
    }

    const stripped = stripMediaForRemovedContributors(
      asSharedPostDataObject(existing.data),
      new Set(toRemove),
    );
    const invitedAt = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.shared_posts.update({
        where: { id: sharedPostId },
        data: {
          title,
          text,
          close_at: closeAt,
          release_at: releaseAt,
          ...(toRemove.length > 0
            ? {
                data: stripped.data as Prisma.InputJsonValue,
                image_id: stripped.imageId,
              }
            : {}),
        },
      });
      if (toRemove.length > 0) {
        await tx.shared_posts_contributors.deleteMany({
          where: {
            shared_post_id: sharedPostId,
            user_id: { in: toRemove },
          },
        });
      }
      if (toInvite.length > 0) {
        await tx.shared_posts_contributors.createMany({
          data: toInvite.map((userId) => ({
            shared_post_id: sharedPostId,
            user_id: userId,
            invited_at: invitedAt,
            invited_by: authResult.user_id,
          })),
          skipDuplicates: true,
        });
      }
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

    const payload: SharedPostUpdateResponse = {
      shared_post: serializeSharedPostListItem({
        row: refreshed,
        viewerUserId: authResult.user_id,
        includeContributors: true,
      }),
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("shared_post_update_failed", error);
    return NextResponse.json(
      { error: { code: "shared_post_update_failed", message: "Failed to update shared post." } },
      { status: 500 },
    );
  }
}
