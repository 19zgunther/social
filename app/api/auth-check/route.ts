import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { getSignedMainBucketImageUrl } from "@/app/api/server_file_storage_utils";

export async function POST(request: Request) {
  const authResult = authCheck(request);

  if (authResult.error) {
    console.error("auth_check_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  const user = await prisma.users.findFirst({
    where: {
      id: authResult.user_id,
    },
    select: {
      profile_image_id: true,
    },
  });

  let profileImageUrl: string | null = null;
  if (user?.profile_image_id) {
    try {
      profileImageUrl = await getSignedMainBucketImageUrl({
        userId: authResult.user_id,
        imageId: user.profile_image_id,
      });
    } catch (error) {
      console.error("auth_check_profile_image_sign_failed", authResult.user_id, error);
    }
  }

  return NextResponse.json(
    {
      ...authResult,
      profile_image_url: profileImageUrl,
    },
    { status: 200 },
  );
}