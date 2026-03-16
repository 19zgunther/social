import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { hashPassword, mintUserToken } from "@/app/api/auth_utils";
import { getSignedMainBucketImageUrl } from "@/app/api/server_file_storage_utils";
import { SignupRequest, SignupResponse } from "@/app/types/interfaces";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SignupRequest;
    const username = body.username?.trim();
    const email = body.email?.trim().toLowerCase() ?? "";
    const password = body.password ?? "";

    if (!username || !password) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "Username and password are required." } },
        { status: 400 },
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: { code: "weak_password", message: "Password must be at least 8 characters." } },
        { status: 400 },
      );
    }

    const existingUser = await prisma.users.findFirst({
      where: {
        OR: [{ username }, ...(email ? [{ email }] : [])],
      },
      select: {
        id: true,
      },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: { code: "user_exists", message: "Username or email already exists." } },
        { status: 409 },
      );
    }

    const passwordHash = await hashPassword(password);
    const createdUser = await prisma.users.create({
      data: {
        username,
        email: email || null,
        password_hash: passwordHash,
        created_at: new Date(),
      },
      select: {
        id: true,
        username: true,
        email: true,
        profile_image_id: true,
      },
    });

    const token = mintUserToken({
      user_id: createdUser.id,
      username: createdUser.username,
      user_email: createdUser.email,
    });

    let profileImageUrl: string | null = null;
    if (createdUser.profile_image_id) {
      try {
        profileImageUrl = await getSignedMainBucketImageUrl({
          userId: createdUser.id,
          imageId: createdUser.profile_image_id,
        });
      } catch (error) {
        console.error("signup_profile_image_sign_failed", createdUser.id, error);
      }
    }

    const payload: SignupResponse = {
      token,
      user: {
        user_id: createdUser.id,
        username: createdUser.username,
        email: createdUser.email,
        profile_image_id: createdUser.profile_image_id,
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
      maxAge: 60 * 60 * 24 * 30,
    });

    return response;
  } catch (error) {
    console.error("signup_failed", error);
    return NextResponse.json(
      { error: { code: "signup_failed", message: "Failed to sign up." } },
      { status: 500 },
    );
  }
}