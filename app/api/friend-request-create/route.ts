import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";

type FriendRequestCreateBody = {
  other_user_id?: string;
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("friend_request_create_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as FriendRequestCreateBody;
    const otherUserId = body.other_user_id?.trim();
    if (!otherUserId) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "other_user_id is required." } },
        { status: 400 },
      );
    }
    if (otherUserId === authResult.user_id) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "Cannot send request to yourself." } },
        { status: 400 },
      );
    }

    const otherUser = await prisma.users.findFirst({
      where: {
        id: otherUserId,
      },
      select: {
        id: true,
      },
    });
    if (!otherUser) {
      return NextResponse.json(
        { error: { code: "user_not_found", message: "User not found." } },
        { status: 404 },
      );
    }

    const existingRow = await prisma.friends.findFirst({
      where: {
        OR: [
          {
            requesting_user: authResult.user_id,
            other_user: otherUserId,
          },
          {
            requesting_user: otherUserId,
            other_user: authResult.user_id,
          },
        ],
      },
      select: {
        id: true,
        requesting_user: true,
        accepted: true,
      },
    });
    if (existingRow) {
      return NextResponse.json(
        {
          error: {
            code: "friend_row_exists",
            message: "A friend relationship already exists for these users.",
          },
        },
        { status: 409 },
      );
    }

    const friend = await prisma.friends.create({
      data: {
        requesting_user: authResult.user_id,
        other_user: otherUserId,
        requested_at: new Date(),
        accepted: null,
        accepted_at: null,
      },
      select: {
        id: true,
        requesting_user: true,
        other_user: true,
        requested_at: true,
        accepted: true,
        accepted_at: true,
      },
    });

    return NextResponse.json({ friend }, { status: 200 });
  } catch (error) {
    console.error("friend_request_create_failed", error);
    return NextResponse.json(
      { error: { code: "friend_request_create_failed", message: "Failed to create friend request." } },
      { status: 500 },
    );
  }
}
