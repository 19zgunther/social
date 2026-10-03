import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { createMainBucketImageAccessGrant } from "@/app/api/image_access_grant";
import {
  asSharedPostDataObject,
  findSharedMediaOwnerUserId,
  getSharedPostPhase,
} from "@/app/lib/sharedPosts";

type RequestBody = {
  image_ids?: string[];
  owner_user_id?: string;
  shared_post_id?: string;
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

    const sharedPostId = body.shared_post_id?.trim() ?? "";
    if (sharedPostId) {
      const membership = await prisma.shared_posts_contributors.findFirst({
        where: {
          shared_post_id: sharedPostId,
          user_id: authResult.user_id,
        },
        select: { id: true },
      });
      if (!membership) {
        return NextResponse.json(
          { error: { code: "forbidden", message: "Cannot load images for this shared post." } },
          { status: 403 },
        );
      }

      const sharedPost = await prisma.shared_posts.findFirst({
        where: { id: sharedPostId },
        select: {
          close_at: true,
          release_at: true,
          data: true,
        },
      });
      if (!sharedPost || getSharedPostPhase(sharedPost.close_at, sharedPost.release_at) !== "released") {
        return NextResponse.json(
          { error: { code: "forbidden", message: "Shared post media is not available yet." } },
          { status: 403 },
        );
      }

      const dataObject = asSharedPostDataObject(sharedPost.data);
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
          });
        } catch (error) {
          console.error("image_access_grant_failed", storageUserId, imageId, error);
          grantsById[imageId] = null;
        }
      }
      return NextResponse.json({ grants_by_id: grantsById }, { status: 200 });
    }

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
