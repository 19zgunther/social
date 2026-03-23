import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { getSignedMainBucketImageUrl } from "@/app/api/server_file_storage_utils";

type ImageUrlsRequest = {
  image_ids?: string[];
  /** Main-bucket paths are `{userId}/{imageId}`; pass the uploader (e.g. post author) when signing someone else's files. */
  owner_user_id?: string;
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
    console.error("image_urls_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ImageUrlsRequest;
    const imageIds = (body.image_ids ?? []).map((value) => value.trim()).filter(Boolean);
    if (imageIds.length === 0) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "image_ids is required." } },
        { status: 400 },
      );
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

    const imageUrlsById: Record<string, string | null> = {};
    await Promise.all(
      imageIds.map(async (imageId) => {
        try {
          imageUrlsById[imageId] = await getSignedMainBucketImageUrl({
            userId: storageUserId,
            imageId,
          });
        } catch (error) {
          console.error("image_urls_sign_failed", storageUserId, imageId, error);
          imageUrlsById[imageId] = null;
        }
      }),
    );

    return NextResponse.json({ image_urls_by_id: imageUrlsById }, { status: 200 });
  } catch (error) {
    console.error("image_urls_failed", error);
    return NextResponse.json(
      { error: { code: "image_urls_failed", message: "Failed to load image urls." } },
      { status: 500 },
    );
  }
}
