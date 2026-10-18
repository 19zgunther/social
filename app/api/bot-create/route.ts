import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { authCheck } from "@/app/api/auth_utils";
import {
  BOT_WITH_USER_SELECT,
  DEFAULT_BOT_SYSTEM_PROMPT,
  MAX_BOTS_PER_USER,
  toBotDetail,
} from "@/app/lib/bots/botHelpers";
import { prisma } from "@/app/lib/prisma";
import { BotCreateRequest, BotCreateResponse } from "@/app/types/interfaces";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as BotCreateRequest;
    const username = body.username?.trim() ?? "";
    if (!USERNAME_RE.test(username)) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_username",
            message: "Username must be 3–32 characters: letters, numbers, or underscores.",
          },
        },
        { status: 400 },
      );
    }

    const botCount = await prisma.bots.count({
      where: { owner_id: authResult.user_id },
    });
    if (botCount >= MAX_BOTS_PER_USER) {
      return NextResponse.json(
        {
          error: {
            code: "bot_limit_reached",
            message: `You can have at most ${MAX_BOTS_PER_USER} bots.`,
          },
        },
        { status: 403 },
      );
    }

    const existing = await prisma.users.findFirst({
      where: { username },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: { code: "username_taken", message: "That username is already taken." } },
        { status: 409 },
      );
    }

    const now = new Date();
    const bot = await prisma.$transaction(async (tx) => {
      const botUser = await tx.users.create({
        data: {
          username,
          email: null,
          password_hash: null,
          created_at: now,
        },
        select: { id: true },
      });

      const createdBot = await tx.bots.create({
        data: {
          user_id: botUser.id,
          owner_id: authResult.user_id,
          system_prompt: DEFAULT_BOT_SYSTEM_PROMPT,
          wake_period: "24h",
          rss_feeds: [] as Prisma.InputJsonValue,
          created_at: now,
          updated_at: now,
        },
        select: BOT_WITH_USER_SELECT,
      });

      await tx.friends.create({
        data: {
          requesting_user: authResult.user_id,
          other_user: botUser.id,
          requested_at: now,
          accepted: true,
          accepted_at: now,
        },
      });

      return createdBot;
    });

    const payload: BotCreateResponse = {
      bot: await toBotDetail(bot, authResult.user_id),
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("bot_create_failed", error);
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: { code: "username_taken", message: "That username is already taken." } },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: { code: "bot_create_failed", message: "Failed to create bot." } },
      { status: 500 },
    );
  }
}
