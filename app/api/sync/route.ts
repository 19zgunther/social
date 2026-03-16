import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { waitForUserSyncEvents } from "@/app/lib/sync";
import { SyncRequest, SyncResponse } from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("sync_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as SyncRequest;
    const timeoutMs = Math.max(1_000, Math.min(body.timeout_ms ?? 25_000, 30_000));
    const maxEvents = Math.max(1, Math.min(body.max_events ?? 20, 50));

    const events = await waitForUserSyncEvents(authResult.user_id, {
      timeoutMs,
      maxEvents,
    });

    const payload: SyncResponse = { events };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("sync_failed", error);
    return NextResponse.json(
      { error: { code: "sync_failed", message: "Failed to receive sync events." } },
      { status: 500 },
    );
  }
}
