import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { sendPushToUsers } from "@/app/lib/push_notifications";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("push_test_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const activeCount = await prisma.push_subscriptions.count({
      where: {
        user_id: authResult.user_id,
        is_active: true,
      },
    });

    if (activeCount === 0) {
      return NextResponse.json(
        {
          error: {
            code: "no_subscriptions",
            message: "No active push subscriptions for this account. Enable notifications first.",
          },
        },
        { status: 400 },
      );
    }

    await sendPushToUsers({
      recipientUserIds: [authResult.user_id],
      payload: {
        title: "Test notification",
        body: "Push notifications are working on this device.",
        url: "/",
      },
    });

    return NextResponse.json({ ok: true, subscription_count: activeCount }, { status: 200 });
  } catch (error) {
    console.error("push_test_failed", error);
    return NextResponse.json(
      { error: { code: "push_test_failed", message: "Failed to send test notification." } },
      { status: 500 },
    );
  }
}
