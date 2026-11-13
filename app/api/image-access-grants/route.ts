/**
 * Mint short-lived "keys" (image access grants) so the client can download photos/videos.
 *
 * Images live in private storage under whoever uploaded them (`{owner_user_id}/{image_id}`).
 * The client asks: "I need these image_ids — give me grants." This route decides:
 *   1) Are you allowed to see them?
 *   2) Which user's storage folder is each image in?
 *
 * Three modes (checked in order):
 * - event_id  → event album; owners come from the event's media list; must be a thread member
 * - post_id   → feed/profile post; owners come from post.data.media; must be allowed to see the post
 * - owner_user_id (fallback) → all requested ids assumed to belong to that one user (legacy simple posts)
 */
import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { createMainBucketImageAccessGrant } from "@/app/api/image_access_grant";
import { canViewerAccessPost } from "@/app/lib/postVisibility";
import { resolveStorageBackends } from "@/app/lib/storageObjects";
import {
  asEventSharedPostData,
  findSharedMediaOwnerUserId,
  isEventAlbumMediaVisible,
} from "@/app/lib/sharedPosts";
import { findThreadEventForMember } from "@/app/lib/threadEvents";

type RequestBody = {
  image_ids?: string[];
  owner_user_id?: string;
  event_id?: string;
  /** Feed post id — use when a post may include media uploaded by multiple people. */
  post_id?: string;
};

async function viewerMayAccessOwnerMedia(viewerId: string, ownerUserId: string): Promise<boolean> {
  if (viewerId === ownerUserId) {
    return true;
  }
  const friend = await prisma.friends.findFirst({
    where: {
      accepted: true,
      OR: [
        { requesting_user: viewerId, other_user: ownerUserId },
        { requesting_user: ownerUserId, other_user: viewerId },
      ],
    },
    select: { requesting_user: true },
  });
  return Boolean(friend);
}

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as RequestBody;
    const imageIds = (body.image_ids ?? []).map((value) => value.trim()).filter(Boolean);
    if (imageIds.length === 0) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "image_ids is required." } },
        { status: 400 },
      );
    }

    const backends = await resolveStorageBackends(imageIds);

    // --- Mode 1: event album (multi-contributor; owners on event.shared_post_data.media) ---
    const eventId = body.event_id?.trim() ?? "";
    if (eventId) {
      const event = await findThreadEventForMember(eventId, authResult.user_id);
      if (!event) {
        return NextResponse.json(
          { error: { code: "forbidden", message: "Cannot load images for this event." } },
          { status: 403 },
        );
      }
      if (!isEventAlbumMediaVisible(event)) {
        return NextResponse.json(
          { error: { code: "forbidden", message: "Event media is not available yet." } },
          { status: 403 },
        );
      }

      const dataObject = asEventSharedPostData(event.shared_post_data);
      const grantsById: Record<string, string | null> = {};
      for (const imageId of imageIds) {
        const storageUserId = findSharedMediaOwnerUserId(dataObject, imageId);
        if (!storageUserId) {
          grantsById[imageId] = null;
          continue;
        }
        try {
          grantsById[imageId] = createMainBucketImageAccessGrant({
            imageId,
            storageUserId,
            viewerUserId: authResult.user_id,
            backend: backends.get(imageId) ?? "supabase",
          });
        } catch (error) {
          console.error("image_access_grant_failed", storageUserId, imageId, error);
          grantsById[imageId] = null;
        }
      }
      return NextResponse.json({ grants_by_id: grantsById }, { status: 200 });
    }

    // --- Mode 2: published feed post (may include photos friends uploaded into an event album) ---
    // Why not just use owner_user_id=post.created_by? Because Alice can publish an album that
    // contains Bob's uploads. Bob's files live under Bob's storage id, not Alice's. If we mint
    // every grant as Alice, Bob's photos fail to load. So we look up each image's real owner
    // from post.data.media[].owner_user_id. Access is "can you see this post?", not "are you
    // friends with every uploader?"
    const postId = body.post_id?.trim() ?? "";
    if (postId) {
      const post = await prisma.posts.findFirst({
        where: { id: postId },
        select: { id: true, created_by: true, permanent: true, data: true },
      });
      if (!post) {
        return NextResponse.json(
          { error: { code: "forbidden", message: "Cannot load images for this post." } },
          { status: 403 },
        );
      }
      // Same visibility rules as the feed (own post, or friend + permanent/access row).
      const allowed = await canViewerAccessPost({
        viewerUserId: authResult.user_id,
        post,
      });
      if (!allowed) {
        return NextResponse.json(
          { error: { code: "forbidden", message: "Cannot load images for this post." } },
          { status: 403 },
        );
      }

      const dataObject = asEventSharedPostData(post.data);
      const grantsById: Record<string, string | null> = {};
      for (const imageId of imageIds) {
        // Prefer the uploader recorded on the media item; fall back to post author for old posts.
        const storageUserId =
          findSharedMediaOwnerUserId(dataObject, imageId) ?? post.created_by;
        try {
          grantsById[imageId] = createMainBucketImageAccessGrant({
            imageId,
            storageUserId,
            viewerUserId: authResult.user_id,
            backend: backends.get(imageId) ?? "supabase",
          });
        } catch (error) {
          console.error("image_access_grant_failed", storageUserId, imageId, error);
          grantsById[imageId] = null;
        }
      }
      return NextResponse.json({ grants_by_id: grantsById }, { status: 200 });
    }

    // --- Mode 3: single-owner (normal posts where every attachment belongs to created_by) ---
    const ownerUserId = body.owner_user_id?.trim() ?? "";
    const storageUserId = ownerUserId || authResult.user_id;
    if (ownerUserId) {
      const allowed = await viewerMayAccessOwnerMedia(authResult.user_id, ownerUserId);
      if (!allowed) {
        return NextResponse.json(
          { error: { code: "forbidden", message: "Cannot load images for this user." } },
          { status: 403 },
        );
      }
    }

    const grantsById: Record<string, string | null> = {};
    for (const imageId of imageIds) {
      try {
        grantsById[imageId] = createMainBucketImageAccessGrant({
          imageId,
          storageUserId,
          viewerUserId: authResult.user_id,
          backend: backends.get(imageId) ?? "supabase",
        });
      } catch (error) {
        console.error("image_access_grant_failed", storageUserId, imageId, error);
        grantsById[imageId] = null;
      }
    }

    return NextResponse.json({ grants_by_id: grantsById }, { status: 200 });
  } catch (error) {
    console.error("image_access_grants_failed", error);
    return NextResponse.json(
      { error: { code: "image_access_grants_failed", message: "Failed to mint image access grants." } },
      { status: 500 },
    );
  }
}
