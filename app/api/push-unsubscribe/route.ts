import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";

type PushUnsubscribeBody = {
  endpoint?: string;
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("push_unsubscribe_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as PushUnsubscribeBody;
    const endpoint = body.endpoint?.trim();
    if (!endpoint) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "endpoint is required." } },
        { status: 400 },
      );
    }

    await prisma.push_subscriptions.updateMany({
      where: {
        endpoint,
        user_id: authResult.user_id,
      },
      data: {
        is_active: false,
        updated_at: new Date(),
      },
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error("push_unsubscribe_failed", error);
    return NextResponse.json(
      { error: { code: "push_unsubscribe_failed", message: "Failed to unsubscribe from push notifications." } },
      { status: 500 },
    );
  }
}
