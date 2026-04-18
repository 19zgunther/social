import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { mintUserToken, verifyPassword } from "@/app/api/auth_utils";
import { getSignedMainBucketImageUrl } from "@/app/api/server_file_storage_utils";
import { LoginRequest, LoginResponse } from "@/app/types/interfaces";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type LoginUser = {
  id: string;
  username: string;
  email: string | null;
  password_hash: string | null;
  profile_image_id: string | null;
};

async function jsonLoginSuccess(user: LoginUser): Promise<NextResponse> {
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

  const payload: LoginResponse = {
    token,
    user: {
      user_id: user.id,
      username: user.username,
      email: user.email,
      profile_image_id: user.profile_image_id,
      profile_image_url: profileImageUrl,
      minted_at: Date.now(),
    },
  };
  const response = NextResponse.json(payload, { status: 200 });

  response.cookies.set("auth_token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  return response;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as LoginRequest;
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

    if (!user) {
      return NextResponse.json(
        { error: { code: "invalid_credentials", message: "Invalid credentials." } },
        { status: 401 },
      );
    }

    let authenticated = false;
    if (user.password_hash && (await verifyPassword(password, user.password_hash))) {
      authenticated = true;
    } else {
      const tempId = password.trim();
      if (UUID_RE.test(tempId)) {
        const consumed = await prisma.temp_passwords.updateMany({
          where: {
            id: tempId,
            user_id: user.id,
            was_used: false,
            expires_at: { gt: new Date() },
          },
          data: { was_used: true },
        });
        authenticated = consumed.count === 1;
      }
    }

    if (!authenticated) {
      return NextResponse.json(
        { error: { code: "invalid_credentials", message: "Invalid credentials." } },
        { status: 401 },
      );
    }

    return jsonLoginSuccess(user);
  } catch (error) {
    console.error("login_failed", error);
    return NextResponse.json(
      { error: { code: "login_failed", message: "Failed to log in." } },
      { status: 500 },
    );
  }
}