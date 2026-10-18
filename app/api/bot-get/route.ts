import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { BOT_WITH_USER_SELECT, toBotDetail } from "@/app/lib/bots/botHelpers";
import { prisma } from "@/app/lib/prisma";
import { BotGetRequest, BotGetResponse } from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as BotGetRequest;
    const botId = body.bot_id?.trim() ?? "";
    if (!botId) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "bot_id is required." } },
        { status: 400 },
      );
    }

    // Any authenticated user can view bot config; mutations stay owner-gated.
    const bot = await prisma.bots.findFirst({
      where: { id: botId },
      select: BOT_WITH_USER_SELECT,
    });
    if (!bot) {
      return NextResponse.json(
        { error: { code: "bot_not_found", message: "Bot not found." } },
        { status: 404 },
      );
    }

    const payload: BotGetResponse = {
      bot: await toBotDetail(bot, authResult.user_id),
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("bot_get_failed", error);
    return NextResponse.json(
      { error: { code: "bot_get_failed", message: "Failed to load bot." } },
      { status: 500 },
    );
  }
}
