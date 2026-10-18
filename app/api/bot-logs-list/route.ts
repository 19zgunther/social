import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { BotLogsListRequest, BotLogsListResponse } from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as BotLogsListRequest;
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

    const logs = await prisma.bot_logs.findMany({
      where: { bot_id: botId },
      orderBy: { created_at: "desc" },
      take: 50,
      select: {
        id: true,
        created_at: true,
        finished_at: true,
        status: true,
        error: true,
      },
    });

    const payload: BotLogsListResponse = {
      logs: logs.map((log) => ({
        id: log.id,
        created_at: log.created_at.toISOString(),
        finished_at: log.finished_at?.toISOString() ?? null,
        status: log.status,
        error: log.error,
      })),
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("bot_logs_list_failed", error);
    return NextResponse.json(
      { error: { code: "bot_logs_list_failed", message: "Failed to list bot logs." } },
      { status: 500 },
    );
  }
}
