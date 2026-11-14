import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runWorkGolfDailyNudge } from "@/app/lib/gameDailyNudge";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    console.error("game_daily_nudge_cron_missing_cron_secret");
    return NextResponse.json(
      { error: { code: "cron_not_configured", message: "CRON_SECRET is not configured." } },
      { status: 500 },
    );
  }
  const provided = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${cronSecret}`;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Unauthorized." } },
      { status: 401 },
    );
  }

  try {
    const result = await runWorkGolfDailyNudge(new Date());
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (error) {
    console.error("game_daily_nudge_cron_failed", error);
    return NextResponse.json(
      { error: { code: "nudge_failed", message: "Failed to send daily nudges." } },
      { status: 500 },
    );
  }
}
