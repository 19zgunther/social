import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { sanitizeNotificationText } from "@/app/lib/notification_text";
import { sendPushToUsers } from "@/app/lib/push_notifications";
import {
  appendSharedPostMedia,
  asSharedPostDataObject,
  countContributorMedia,
  getSharedPostPhase,
  parseSharedPostMediaItems,
} from "@/app/lib/sharedPosts";
import type {
  SharedPostContributeRequest,
  SharedPostContributeResponse,
} from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("shared_post_contribute_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as SharedPostContributeRequest;
    const sharedPostId = body.shared_post_id?.trim() ?? "";
    const parsedMedia = parseSharedPostMediaItems(body.media);
    if (!sharedPostId) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "shared_post_id is required." } },
        { status: 400 },
      );
    }
    if (!parsedMedia) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_media",
            message: "media must be a non-empty list of items with owner_user_id.",
          },
        },
        { status: 400 },
      );
    }

    const membership = await prisma.shared_posts_contributors.findFirst({
      where: {
        shared_post_id: sharedPostId,
        user_id: authResult.user_id,
      },
      select: { id: true },
    });
    if (!membership) {
      return NextResponse.json(
        { error: { code: "not_allowed", message: "You are not invited to this shared post." } },
        { status: 403 },
      );
    }

    const existing = await prisma.shared_posts.findFirst({
      where: { id: sharedPostId },
      select: {
        id: true,
        title: true,
        close_at: true,
        release_at: true,
        data: true,
        image_id: true,
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
    if (getSharedPostPhase(existing.close_at, existing.release_at) !== "open") {
      return NextResponse.json(
        {
          error: {
            code: "closed",
            message: "Contributions are only allowed before the close date.",
          },
        },
        { status: 400 },
      );
    }

    const existingData = asSharedPostDataObject(existing.data);
    const appended = appendSharedPostMedia({
      existingData,
      newMedia: parsedMedia,
      contributorUserId: authResult.user_id,
    });
    if (!appended.ok) {
      return NextResponse.json(
        { error: { code: appended.code, message: appended.message } },
        { status: 400 },
      );
    }

    await prisma.shared_posts.update({
      where: { id: sharedPostId },
      data: {
        data: appended.data as Prisma.InputJsonValue,
        image_id: existing.image_id ?? appended.imageId,
      },
    });

    const recipientUserIds = existing.shared_posts_contributors
      .map((contributor) => contributor.user_id)
      .filter((userId) => userId !== authResult.user_id);
    if (recipientUserIds.length > 0) {
      const eventTitle = sanitizeNotificationText(existing.title) || "a shared event";
      const mediaCount = parsedMedia.length;
      const allVideos = parsedMedia.every((item) => item.kind === "video");
      const mediaLabel =
        mediaCount === 1
          ? allVideos
            ? "a video"
            : "a photo"
          : allVideos
            ? `${mediaCount} videos`
            : `${mediaCount} photos`;
      void sendPushToUsers({
        recipientUserIds,
        payload: {
          title: eventTitle,
          body: `${authResult.username} added ${mediaLabel} to ${eventTitle}.`,
          url: "/?tab=shared_event_posts",
        },
      }).catch((error) => {
        console.error("shared_post_contribute_push_dispatch_failed", error);
      });
    }

    const contributedCount = countContributorMedia(appended.data.media ?? [], authResult.user_id);
    const payload: SharedPostContributeResponse = {
      ok: true,
      contributed_count: contributedCount,
    };
    // Blind contribute: never return media.
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("shared_post_contribute_failed", error);
    return NextResponse.json(
      {
        error: {
          code: "shared_post_contribute_failed",
          message: "Failed to contribute to shared post.",
        },
      },
      { status: 500 },
    );
  }
}
