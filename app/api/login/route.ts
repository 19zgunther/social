import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { mintUserToken, verifyPassword } from "@/app/api/auth_utils";
import { getSignedMainBucketImageUrl } from "@/app/api/server_file_storage_utils";

type LoginBody = {
  identifier?: string;
  password?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as LoginBody;
    const identifier = body.identifier?.trim();
    const password = body.password ?? "";

    if (!identifier || !password) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "Identifier and password are required." } },
        { status: 400 },
      );
    }

    const user = await prisma.users.findFirst({
      where: {
        OR: [{ username: identifier }, { email: identifier.toLowerCase() }],
      },
      select: {
        id: true,
        username: true,
        email: true,
        password_hash: true,
        profile_image_id: true,
      },
    });

    if (!user?.password_hash) {
      return NextResponse.json(
        { error: { code: "invalid_credentials", message: "Invalid credentials." } },
        { status: 401 },
      );
    }

    const isValidPassword = await verifyPassword(password, user.password_hash);
    if (!isValidPassword) {
      return NextResponse.json(
        { error: { code: "invalid_credentials", message: "Invalid credentials." } },
        { status: 401 },
      );
    }

    const token = mintUserToken({
      user_id: user.id,
      username: user.username,
      user_email: user.email,
    });

    let profileImageUrl: string | null = null;
    if (user.profile_image_id) {
      try {
        profileImageUrl = await getSignedMainBucketImageUrl({
          userId: user.id,
          imageId: user.profile_image_id,
        });
      } catch (error) {
        console.error("login_profile_image_sign_failed", user.id, error);
      }
    }

    const response = NextResponse.json(
      {
        token,
        user: {
          user_id: user.id,
          username: user.username,
          email: user.email,
          profile_image_url: profileImageUrl,
        },
      },
      { status: 200 },
    );

    response.cookies.set("auth_token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    return response;
  } catch (error) {
    console.error("login_failed", error);
    return NextResponse.json(
      { error: { code: "login_failed", message: "Failed to log in." } },
      { status: 500 },
    );
  }
}