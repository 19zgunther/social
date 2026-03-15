import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";

type FriendRequestRespondBody = {
  friend_id?: string;
  accept?: boolean;
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("friend_request_respond_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as FriendRequestRespondBody;
    const friendId = body.friend_id?.trim();
    const accept = body.accept;

    if (!friendId || typeof accept !== "boolean") {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "friend_id and accept are required." } },
        { status: 400 },
      );
    }

    const friendRow = await prisma.friends.findFirst({
      where: {
        id: friendId,
      },
      select: {
        id: true,
        other_user: true,
        accepted: true,
      },
    });
    if (!friendRow) {
      return NextResponse.json(
        { error: { code: "friend_request_not_found", message: "Friend request not found." } },
        { status: 404 },
      );
    }

    if (friendRow.other_user !== authResult.user_id) {
      return NextResponse.json(
        { error: { code: "not_allowed", message: "Only requested user can respond." } },
        { status: 403 },
      );
    }
    if (friendRow.accepted !== null) {
      return NextResponse.json(
        { error: { code: "already_responded", message: "Friend request already responded to." } },
        { status: 409 },
      );
    }

    const updated = await prisma.friends.update({
      where: {
        id: friendId,
      },
      data: {
        accepted: accept,
        accepted_at: accept ? new Date() : null,
      },
      select: {
        id: true,
        accepted: true,
        accepted_at: true,
      },
    });

    return NextResponse.json({ friend: updated }, { status: 200 });
  } catch (error) {
    console.error("friend_request_respond_failed", error);
    return NextResponse.json(
      { error: { code: "friend_request_respond_failed", message: "Failed to respond to request." } },
      { status: 500 },
    );
  }
}
