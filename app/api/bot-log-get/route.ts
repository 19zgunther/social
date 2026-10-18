import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { BotLogGetRequest, BotLogGetResponse } from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as BotLogGetRequest;
    const logId = body.log_id?.trim() ?? "";
    if (!logId) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "log_id is required." } },
        { status: 400 },
      );
    }

    const log = await prisma.bot_logs.findFirst({
      where: { id: logId },
      select: {
        id: true,
        bot_id: true,
        created_at: true,
        finished_at: true,
        status: true,
        error: true,
        messages: true,
        bots: {
          select: { owner_id: true },
        },
      },
    });

    if (!log || log.bots.owner_id !== authResult.user_id) {
      return NextResponse.json(
        { error: { code: "log_not_found", message: "Log not found." } },
        { status: 404 },
      );
    }

    const payload: BotLogGetResponse = {
      log: {
        id: log.id,
        bot_id: log.bot_id,
        created_at: log.created_at.toISOString(),
        finished_at: log.finished_at?.toISOString() ?? null,
        status: log.status,
        error: log.error,
        messages: log.messages,
      },
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("bot_log_get_failed", error);
    return NextResponse.json(
      { error: { code: "bot_log_get_failed", message: "Failed to load bot log." } },
      { status: 500 },
    );
  }
}
