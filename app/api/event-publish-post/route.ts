import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { authCheck } from "@/app/api/auth_utils";
import { createMainBucketImageAccessGrantAsync } from "@/app/api/image_access_grant";
import { prisma } from "@/app/lib/prisma";
import { sanitizeNotificationText } from "@/app/lib/notification_text";
import { resolvePostAudience } from "@/app/lib/postVisibility";
import { sanitizePostDataForViewer } from "@/app/lib/polls";
import { sendPushToUsers } from "@/app/lib/push_notifications";
import { getPostCoverObject } from "@/app/lib/postMedia";
import {
  asEventSharedPostData,
  isEventAlbumMediaVisible,
} from "@/app/lib/sharedPosts";
import {
  finalizeThreadEventItem,
  findThreadEventForMember,
  userCanAdminThreadEvent,
  userIsEventCohost,
} from "@/app/lib/threadEvents";
import type {
  EventPublishPostRequest,
  EventPublishPostResponse,
  PostData,
  PostItem,
} from "@/app/types/interfaces";

const POST_PUSH_PREVIEW_MAX_LENGTH = 120;

const getAlbumPushPreviewText = (caption: string, hasVideo: boolean, hasImage: boolean): string => {
  const sanitizedText = sanitizeNotificationText(caption);
  if (sanitizedText) {
    return sanitizedText.slice(0, POST_PUSH_PREVIEW_MAX_LENGTH);
  }
  if (hasVideo && hasImage) {
    return "Shared photos and video";
  }
  if (hasVideo) {
    return "Shared a video";
  }
  if (hasImage) {
    return "Shared a photo";
  }
  return "Shared a new post";
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("event_publish_post_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as EventPublishPostRequest;
    const eventId = body.event_id?.trim() ?? "";
    if (!eventId) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "event_id is required." } },
        { status: 400 },
      );
    }

    const existing = await findThreadEventForMember(eventId, authResult.user_id);
    if (!existing) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Event not found or inaccessible." } },
        { status: 404 },
      );
    }

    const threadOwnerId = existing.threads_thread_events_thread_idTothreads.owner;
    const isCohost = await userIsEventCohost(existing.id, authResult.user_id);
    if (
      !userCanAdminThreadEvent({
        userId: authResult.user_id,
        threadOwnerId,
        eventCreatedBy: existing.created_by,
        isCohost,
      })
    ) {
      return NextResponse.json(
        {
          error: {
            code: "forbidden",
            message: "Only the event owner or a co-host can publish.",
          },
        },
        { status: 403 },
      );
    }

    if (existing.published_post_id) {
      return NextResponse.json(
        { error: { code: "already_published", message: "This event album was already published as a post." } },
        { status: 400 },
      );
    }

    if (!isEventAlbumMediaVisible(existing)) {
      return NextResponse.json(
        {
          error: {
            code: "album_not_visible",
            message: "Wait until the album is released before publishing.",
          },
        },
        { status: 400 },
      );
    }

    const album = asEventSharedPostData(existing.shared_post_data);
    const media = Array.isArray(album.media) ? album.media : [];
    if (media.length === 0) {
      return NextResponse.json(
        { error: { code: "empty_album", message: "Add at least one photo or video before publishing." } },
        { status: 400 },
      );
    }

    const resolved = await resolvePostAudience({
      authorUserId: authResult.user_id,
      audience: { mode: "permanent" },
    });
    if ("error" in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: 400 });
    }
    const friendViewerIds = resolved.audience.viewerIds;

    // posts.image_id / other_image_ids are dead — store media only.
    const postData: PostData = { media };

    const caption =
      [existing.name.trim(), existing.description?.trim()].filter(Boolean).join("\n\n") || existing.name;

    const createdAt = new Date();
    const { post, event } = await prisma.$transaction(async (tx) => {
      const createdPost = await tx.posts.create({
        data: {
          created_by: authResult.user_id,
          text: caption,
          permanent: true,
          data: postData as Prisma.InputJsonValue,
        },
        select: {
          id: true,
          created_at: true,
          created_by: true,
          text: true,
          data: true,
        },
      });

      const updatedEvent = await tx.thread_events.update({
        where: { id: existing.id },
        data: {
          published_post_id: createdPost.id,
          updated_at: createdAt,
        },
      });

      return { post: createdPost, event: updatedEvent };
    });

    const recipientUserIds = friendViewerIds.filter((id) => id !== authResult.user_id);
    if (recipientUserIds.length > 0) {
      const hasVideo = media.some((item) => item.kind === "video");
      const hasImage = media.some((item) => item.kind === "image");
      void sendPushToUsers({
        recipientUserIds,
        payload: {
          title: `${authResult.username} make a post`,
          body: getAlbumPushPreviewText(caption, hasVideo, hasImage),
          url: "/?tab=feed",
        },
      }).catch((error) => {
        console.error("event_publish_post_push_failed", error);
      });
    }

    const author = await prisma.users.findFirst({
      where: { id: authResult.user_id },
      select: {
        profile_image_id: true,
        email: true,
      },
    });

    let authorProfileImageAccessGrant: string | null = null;
    if (author?.profile_image_id) {
      try {
        authorProfileImageAccessGrant = await createMainBucketImageAccessGrantAsync({
          imageId: author.profile_image_id,
          storageUserId: authResult.user_id,
          viewerUserId: authResult.user_id,
        });
      } catch (error) {
        console.error("event_publish_post_author_grant_failed", error);
      }
    }

    const data = sanitizePostDataForViewer({
      data: post.data,
      viewerUserId: authResult.user_id,
      authorUserId: post.created_by,
    });
    const cover = getPostCoverObject(data);
    let coverImageAccessGrant: string | null = null;
    if (cover) {
      try {
        coverImageAccessGrant = await createMainBucketImageAccessGrantAsync({
          imageId: cover.objectId,
          storageUserId: cover.ownerUserId ?? post.created_by,
          viewerUserId: authResult.user_id,
        });
      } catch (error) {
        console.error("event_publish_post_cover_grant_failed", post.id, error);
      }
    }

    const postItem: PostItem = {
      id: post.id,
      created_at: post.created_at.toISOString(),
      created_by: post.created_by,
      text: post.text ?? "",
      data,
      cover_image_id: cover?.objectId ?? null,
      cover_image_access_grant: coverImageAccessGrant,
      like_count: 0,
      is_liked_by_viewer: false,
      username: authResult.username,
      email: author?.email ?? authResult.email ?? null,
      viewer_can_delete: true,
      author_profile_image_id: author?.profile_image_id ?? null,
      author_profile_image_url: null,
      author_profile_image_access_grant: authorProfileImageAccessGrant,
    };

    const payload: EventPublishPostResponse = {
      post: postItem,
      event: await finalizeThreadEventItem(event, authResult.user_id),
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("event_publish_post_failed", error);
    return NextResponse.json(
      { error: { code: "event_publish_post_failed", message: "Failed to publish event album." } },
      { status: 500 },
    );
  }
}
