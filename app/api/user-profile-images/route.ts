import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { createMainBucketImageAccessGrant } from "@/app/api/image_access_grant";
import { prisma } from "@/app/lib/prisma";
import type {
  UserProfileImageEntry,
  UserProfileImagesRequest,
  UserProfileImagesResponse,
} from "@/app/types/interfaces";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_USER_IDS = 50;

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("user_profile_images_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as UserProfileImagesRequest;
    const userIds = [
      ...new Set(
        (body.user_ids ?? [])
          .map((value) => value.trim())
          .filter((value) => UUID_RE.test(value)),
      ),
    ].slice(0, MAX_USER_IDS);

    if (userIds.length === 0) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "user_ids is required." } },
        { status: 400 },
      );
    }

    const users = await prisma.users.findMany({
      where: { id: { in: userIds } },
      select: { id: true, profile_image_id: true },
    });

    const profiles: Record<string, UserProfileImageEntry> = {};
    for (const userId of userIds) {
      profiles[userId] = {
        profile_image_id: null,
        profile_image_access_grant: null,
      };
    }

    for (const user of users) {
      let grant: string | null = null;
      if (user.profile_image_id) {
        try {
          grant = createMainBucketImageAccessGrant({
            imageId: user.profile_image_id,
            storageUserId: user.id,
            viewerUserId: authResult.user_id,
          });
        } catch (error) {
          console.error("user_profile_images_grant_failed", user.id, error);
        }
      }
      profiles[user.id] = {
        profile_image_id: user.profile_image_id,
        profile_image_access_grant: grant,
      };
    }

    const payload: UserProfileImagesResponse = { profiles };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("user_profile_images_failed", error);
    return NextResponse.json(
      {
        error: {
          code: "user_profile_images_failed",
          message: "Failed to load profile images.",
        },
      },
      { status: 500 },
    );
  }
}
