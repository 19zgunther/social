import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { runBotWake } from "@/app/lib/bots/botRunner";
import { prisma } from "@/app/lib/prisma";
import { BotWakeRequest, BotWakeResponse } from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as BotWakeRequest;
    const botId = body.bot_id?.trim() ?? "";
    if (!botId) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "bot_id is required." } },
        { status: 400 },
      );
    }

    const bot = await prisma.bots.findFirst({
      where: { id: botId, owner_id: authResult.user_id },
      select: { id: true },
    });
    if (!bot) {
      return NextResponse.json(
        { error: { code: "bot_not_found", message: "Bot not found." } },
        { status: 404 },
      );
    }

    const result = await runBotWake({ botId: bot.id });
    const payload: BotWakeResponse = {
      log_id: result.log_id,
      status: result.status,
      ...(result.error ? { error: result.error } : {}),
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("bot_wake_failed", error);
    return NextResponse.json(
      { error: { code: "bot_wake_failed", message: "Failed to wake bot." } },
      { status: 500 },
    );
  }
}
