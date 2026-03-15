import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";

type PushSubscribeBody = {
  endpoint?: string;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("push_subscribe_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as PushSubscribeBody;
    const endpoint = body.endpoint?.trim();
    const p256dh = body.keys?.p256dh?.trim();
    const auth = body.keys?.auth?.trim();
    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "subscription endpoint and keys are required." } },
        { status: 400 },
      );
    }

    const now = new Date();
    await prisma.push_subscriptions.upsert({
      where: {
        endpoint,
      },
      create: {
        user_id: authResult.user_id,
        endpoint,
        p256dh,
        auth,
        is_active: true,
        user_agent: request.headers.get("user-agent"),
        created_at: now,
        updated_at: now,
        last_seen_at: now,
      },
      update: {
        user_id: authResult.user_id,
        p256dh,
        auth,
        is_active: true,
        user_agent: request.headers.get("user-agent"),
        updated_at: now,
        last_seen_at: now,
      },
      select: {
        id: true,
      },
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error("push_subscribe_failed", error);
    return NextResponse.json(
      { error: { code: "push_subscribe_failed", message: "Failed to save push subscription." } },
      { status: 500 },
    );
  }
}
