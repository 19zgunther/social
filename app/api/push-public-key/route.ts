import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { getPublicVapidKey } from "@/app/lib/push_notifications";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("push_public_key_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    return NextResponse.json({ vapid_public_key: getPublicVapidKey() }, { status: 200 });
  } catch (error) {
    console.error("push_public_key_failed", error);
    return NextResponse.json(
      { error: { code: "push_public_key_failed", message: "Push notifications are not configured." } },
      { status: 500 },
    );
  }
}
