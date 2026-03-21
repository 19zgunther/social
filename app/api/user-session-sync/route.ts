import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";

export async function POST(_request: Request) {
  const authResult = authCheck(_request);
  if (authResult.error) {
    console.error("user_session_sync_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    await prisma.user_sessions.upsert({
      where: { user_id: authResult.user_id },
      create: {
        user_id: authResult.user_id,
        updated_at: new Date(),
      },
      update: {
        updated_at: new Date(),
      },
    });

    const acceptedRows = await prisma.friends.findMany({
      where: {
        accepted: true,
        OR: [{ requesting_user: authResult.user_id }, { other_user: authResult.user_id }],
      },
      select: {
        requesting_user: true,
        other_user: true,
      },
    });

    const friendIds = acceptedRows.map((row) =>
      row.requesting_user === authResult.user_id ? row.other_user : row.requesting_user,
    );

    if (friendIds.length === 0) {
      return NextResponse.json({ last_active_by_user_id: {} }, { status: 200 });
    }

    const sessions = await prisma.user_sessions.findMany({
      where: { user_id: { in: friendIds } },
      select: { user_id: true, updated_at: true },
    });

    const last_active_by_user_id: Record<string, string> = {};
    for (const session of sessions) {
      last_active_by_user_id[session.user_id] = session.updated_at.toISOString();
    }

    return NextResponse.json({ last_active_by_user_id }, { status: 200 });
  } catch (error) {
    console.error("user_session_sync_failed", error);
    return NextResponse.json(
      { error: { code: "user_session_sync_failed", message: "Failed to sync session." } },
      { status: 500 },
    );
  }
}
