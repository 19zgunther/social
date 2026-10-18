import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import {
  BotProfileImageRemoveRequest,
  ProfileImageRemoveResponse,
} from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as BotProfileImageRemoveRequest;
    const botId = body.bot_id?.trim() ?? "";
    if (!botId) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "bot_id is required." } },
        { status: 400 },
      );
    }

    const bot = await prisma.bots.findFirst({
      where: { id: botId, owner_id: authResult.user_id },
      select: { user_id: true },
    });
    if (!bot) {
      return NextResponse.json(
        { error: { code: "bot_not_found", message: "Bot not found." } },
        { status: 404 },
      );
    }

    await prisma.users.update({
      where: { id: bot.user_id },
      data: { profile_image_id: null },
    });

    const payload: ProfileImageRemoveResponse = {
      profile_image_id: null,
      profile_image_url: null,
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("bot_profile_image_remove_failed", error);
    return NextResponse.json(
      {
        error: {
          code: "bot_profile_image_remove_failed",
          message: "Failed to remove bot profile image.",
        },
      },
      { status: 500 },
    );
  }
}
