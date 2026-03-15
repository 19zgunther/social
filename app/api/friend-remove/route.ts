import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";

type FriendRemoveBody = {
  friend_id?: string;
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("friend_remove_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as FriendRemoveBody;
    const friendId = body.friend_id?.trim();
    if (!friendId) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "friend_id is required." } },
        { status: 400 },
      );
    }

    const friendRow = await prisma.friends.findFirst({
      where: {
        id: friendId,
      },
      select: {
        id: true,
        requesting_user: true,
        other_user: true,
      },
    });
    if (!friendRow) {
      return NextResponse.json(
        { error: { code: "friend_not_found", message: "Friend row not found." } },
        { status: 404 },
      );
    }

    const isParticipant =
      friendRow.requesting_user === authResult.user_id || friendRow.other_user === authResult.user_id;
    if (!isParticipant) {
      return NextResponse.json(
        { error: { code: "not_allowed", message: "You can only remove your own friendships." } },
        { status: 403 },
      );
    }

    await prisma.friends.delete({
      where: {
        id: friendRow.id,
      },
    });

    return NextResponse.json({ ok: true, friend_id: friendRow.id }, { status: 200 });
  } catch (error) {
    console.error("friend_remove_failed", error);
    return NextResponse.json(
      { error: { code: "friend_remove_failed", message: "Failed to remove friend." } },
      { status: 500 },
    );
  }
}
