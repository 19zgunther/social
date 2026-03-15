import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("profile_image_remove_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    await prisma.users.update({
      where: {
        id: authResult.user_id,
      },
      data: {
        profile_image_id: null,
      },
      select: {
        id: true,
      },
    });

    return NextResponse.json(
      {
        profile_image_id: null,
        profile_image_url: null,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("profile_image_remove_failed", error);
    return NextResponse.json(
      { error: { code: "profile_image_remove_failed", message: "Failed to remove profile image." } },
      { status: 500 },
    );
  }
}
