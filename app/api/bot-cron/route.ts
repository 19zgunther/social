import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runBotWake } from "@/app/lib/bots/botRunner";
import { isBotDueAt } from "@/app/lib/bots/botHelpers";
import { prisma } from "@/app/lib/prisma";

export const dynamic = "force-dynamic";
// A wake can take up to ~5m (see botRunner); give the whole batch room.
// Vercel caps this at your plan's max function duration.
export const maxDuration = 300;

/** Bots woken in parallel per batch; keeps OpenAI/DB load bounded. */
const CONCURRENCY = 3;

type CronBotResult = {
  bot_id: string;
  wake_period: "24h" | "1w";
  log_id?: string;
  status: "completed" | "failed";
  error?: string;
};

export async function GET(request: Request) {
  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when the
  // CRON_SECRET env var is set on the project. Fail closed if it isn't,
  // so this endpoint can never be triggered publicly.
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    console.error("bot_cron_missing_cron_secret");
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
    // Runs daily at 13:00 UTC (see vercel.json; Hobby allows one run/day).
    // Each bot wakes once its configured local time (and weekday, for weekly
    // bots) has passed in its own timezone and it hasn't already woken that
    // local day. Missed windows catch up on the next daily tick.
    const now = new Date();
    const bots = await prisma.bots.findMany({
      select: {
        id: true,
        wake_period: true,
        wake_time: true,
        wake_weekday: true,
        wake_timezone: true,
        last_woke_at: true,
      },
      orderBy: { created_at: "asc" },
    });

    const due: { id: string; wake_period: "24h" | "1w" }[] = [];
    let skipped = 0;
    for (const bot of bots) {
      if (isBotDueAt(now, bot)) {
        due.push({ id: bot.id, wake_period: bot.wake_period === "1w" ? "1w" : "24h" });
      } else {
        skipped += 1;
      }
    }

    const results: CronBotResult[] = [];
    for (let index = 0; index < due.length; index += CONCURRENCY) {
      const batch = due.slice(index, index + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (bot): Promise<CronBotResult> => {
          try {
            const result = await runBotWake({ botId: bot.id });
            return {
              bot_id: bot.id,
              wake_period: bot.wake_period,
              log_id: result.log_id,
              status: result.status,
              ...(result.error ? { error: result.error } : {}),
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : "Bot wake failed.";
            console.error("bot_cron_wake_failed", bot.id, error);
            return { bot_id: bot.id, wake_period: bot.wake_period, status: "failed", error: message };
          }
        }),
      );
      results.push(...batchResults);
    }

    const payload = {
      ok: true,
      ran_at: new Date(now).toISOString(),
      due: due.length,
      skipped,
      completed: results.filter((result) => result.status === "completed").length,
      failed: results.filter((result) => result.status === "failed").length,
      results,
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("bot_cron_failed", error);
    return NextResponse.json(
      { error: { code: "bot_cron_failed", message: "Failed to run scheduled bots." } },
      { status: 500 },
    );
  }
}
