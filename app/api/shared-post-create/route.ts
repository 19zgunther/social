import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { loadAcceptedFriendIds } from "@/app/lib/acceptedFriendIds";
import {
  serializeSharedPostListItem,
  sharedPostSelectForSerialize,
  validateSharedPostDates,
} from "@/app/lib/sharedPosts";
import type { SharedPostCreateRequest, SharedPostCreateResponse } from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("shared_post_create_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as SharedPostCreateRequest;
    const title = body.title?.trim() ?? "";
    const text = body.text?.trim() || null;
    const closeAtRaw = body.close_at?.trim() ?? "";
    const releaseAtRaw = body.release_at?.trim() ?? "";
    const inviteeUserIds = Array.from(
      new Set((body.invitee_user_ids ?? []).map((id) => id.trim()).filter(Boolean)),
    ).filter((id) => id !== authResult.user_id);

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

    const closeAt = new Date(closeAtRaw);
    const releaseAt = new Date(releaseAtRaw);
    const datesOk = validateSharedPostDates(closeAt, releaseAt);
    if (!datesOk.ok) {
      return NextResponse.json(
        { error: { code: datesOk.code, message: datesOk.message } },
        { status: 400 },
      );
    }

    if (inviteeUserIds.length > 0) {
      const friendIds = await loadAcceptedFriendIds(authResult.user_id);
      const nonFriends = inviteeUserIds.filter((id) => !friendIds.has(id));
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
        where: { id: { in: inviteeUserIds } },
        select: { id: true },
      });
      if (existingUsers.length !== inviteeUserIds.length) {
        return NextResponse.json(
          { error: { code: "invitee_not_found", message: "One or more invitees were not found." } },
          { status: 400 },
        );
      }
    }

    const invitedAt = new Date();
    const created = await prisma.shared_posts.create({
      data: {
        created_by: authResult.user_id,
        title,
        text,
        close_at: closeAt,
        release_at: releaseAt,
        data: {},
        shared_posts_contributors: {
          create: [
            {
              user_id: authResult.user_id,
              invited_at: invitedAt,
              invited_by: authResult.user_id,
            },
            ...inviteeUserIds.map((userId) => ({
              user_id: userId,
              invited_at: invitedAt,
              invited_by: authResult.user_id,
            })),
          ],
        },
      },
      select: sharedPostSelectForSerialize,
    });

    const payload: SharedPostCreateResponse = {
      shared_post: serializeSharedPostListItem({
        row: created,
        viewerUserId: authResult.user_id,
        includeContributors: true,
      }),
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("shared_post_create_failed", error);
    return NextResponse.json(
      { error: { code: "shared_post_create_failed", message: "Failed to create shared post." } },
      { status: 500 },
    );
  }
}
