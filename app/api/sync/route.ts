import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { waitForUserSyncEvents } from "@/app/lib/sync";

type SyncBody = {
  timeout_ms?: number;
  max_events?: number;
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("sync_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as SyncBody;
    const timeoutMs = Math.max(1_000, Math.min(body.timeout_ms ?? 25_000, 30_000));
    const maxEvents = Math.max(1, Math.min(body.max_events ?? 20, 50));

    const events = await waitForUserSyncEvents(authResult.user_id, {
      timeoutMs,
      maxEvents,
    });

    return NextResponse.json({ events }, { status: 200 });
  } catch (error) {
    console.error("sync_failed", error);
    return NextResponse.json(
      { error: { code: "sync_failed", message: "Failed to receive sync events." } },
      { status: 500 },
    );
  }
}
