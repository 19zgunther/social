import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";

type FriendRequestCancelBody = {
  friend_id?: string;
  other_user_id?: string;
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("friend_request_cancel_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as FriendRequestCancelBody;
    const friendId = body.friend_id?.trim();
    const otherUserId = body.other_user_id?.trim();
    if (!friendId && !otherUserId) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "friend_id or other_user_id is required.",
          },
        },
        { status: 400 },
      );
    }

    const friendRow = await prisma.friends.findFirst({
      where: friendId
        ? { id: friendId }
        : {
            requesting_user: authResult.user_id,
            other_user: otherUserId,
          },
      select: {
        id: true,
        requesting_user: true,
        accepted: true,
      },
    });
    if (!friendRow) {
      return NextResponse.json(
        { error: { code: "friend_request_not_found", message: "Friend request not found." } },
        { status: 404 },
      );
    }

    if (friendRow.requesting_user !== authResult.user_id) {
      return NextResponse.json(
        { error: { code: "not_allowed", message: "Only the sender can cancel a friend request." } },
        { status: 403 },
      );
    }

    // Already accepted (or rejected): no-op — do not unfriend or delete the row.
    if (friendRow.accepted !== null) {
      return NextResponse.json(
        { ok: true, cancelled: false, friend_id: friendRow.id },
        { status: 200 },
      );
    }

    await prisma.friends.delete({
      where: {
        id: friendRow.id,
      },
    });

    return NextResponse.json(
      { ok: true, cancelled: true, friend_id: friendRow.id },
      { status: 200 },
    );
  } catch (error) {
    console.error("friend_request_cancel_failed", error);
    return NextResponse.json(
      { error: { code: "friend_request_cancel_failed", message: "Failed to cancel friend request." } },
      { status: 500 },
    );
  }
}
