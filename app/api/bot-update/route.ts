import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { authCheck } from "@/app/api/auth_utils";
import {
  BOT_WITH_USER_SELECT,
  isBotWakePeriod,
  isBotWakeTime,
  isBotWakeTimezone,
  isBotWakeWeekday,
  parseRssFeedsJson,
  toBotDetail,
} from "@/app/lib/bots/botHelpers";
import { prisma } from "@/app/lib/prisma";
import { BotUpdateRequest, BotUpdateResponse } from "@/app/types/interfaces";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as BotUpdateRequest;
    const botId = body.bot_id?.trim() ?? "";
    if (!botId) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "bot_id is required." } },
        { status: 400 },
      );
    }

    const existing = await prisma.bots.findFirst({
      where: { id: botId, owner_id: authResult.user_id },
      select: {
        id: true,
        user_id: true,
        users_bot: { select: { username: true } },
      },
    });
    if (!existing) {
      return NextResponse.json(
        { error: { code: "bot_not_found", message: "Bot not found." } },
        { status: 404 },
      );
    }

    const nextUsername =
      body.username !== undefined ? body.username.trim() : existing.users_bot.username;
    if (!USERNAME_RE.test(nextUsername)) {
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

    if (nextUsername !== existing.users_bot.username) {
      const taken = await prisma.users.findFirst({
        where: { username: nextUsername },
        select: { id: true },
      });
      if (taken) {
        return NextResponse.json(
          { error: { code: "username_taken", message: "That username is already taken." } },
          { status: 409 },
        );
      }
    }

    if (
      body.is_private !== undefined &&
      body.is_private !== null &&
      typeof body.is_private !== "boolean"
    ) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_is_private",
            message: "is_private must be true, false, or null.",
          },
        },
        { status: 400 },
      );
    }

    if (body.wake_period !== undefined && !isBotWakePeriod(body.wake_period)) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_wake_period",
            message: "wake_period must be 24h or 1w.",
          },
        },
        { status: 400 },
      );
    }

    if (body.wake_time !== undefined && !isBotWakeTime(body.wake_time)) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_wake_time",
            message: "wake_time must be a 24-hour HH:MM time.",
          },
        },
        { status: 400 },
      );
    }

    if (body.wake_weekday !== undefined && !isBotWakeWeekday(body.wake_weekday)) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_wake_weekday",
            message: "wake_weekday must be an integer 0 (Sunday) to 6 (Saturday).",
          },
        },
        { status: 400 },
      );
    }

    if (body.wake_timezone !== undefined && !isBotWakeTimezone(body.wake_timezone)) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_wake_timezone",
            message: "wake_timezone must be an IANA timezone name.",
          },
        },
        { status: 400 },
      );
    }

    const now = new Date();
    const bot = await prisma.$transaction(async (tx) => {
      if (nextUsername !== existing.users_bot.username) {
        await tx.users.update({
          where: { id: existing.user_id },
          data: { username: nextUsername },
        });
      }

      return tx.bots.update({
        where: { id: botId },
        data: {
          ...(body.system_prompt !== undefined
            ? { system_prompt: body.system_prompt }
            : {}),
          ...(body.description !== undefined
            ? { description: body.description.trim() }
            : {}),
          ...(body.is_private !== undefined ? { is_private: body.is_private } : {}),
          ...(body.wake_period !== undefined ? { wake_period: body.wake_period } : {}),
          ...(body.wake_time !== undefined ? { wake_time: body.wake_time } : {}),
          ...(body.wake_weekday !== undefined ? { wake_weekday: body.wake_weekday } : {}),
          ...(body.wake_timezone !== undefined ? { wake_timezone: body.wake_timezone } : {}),
          ...(body.rss_feeds !== undefined
            ? { rss_feeds: parseRssFeedsJson(body.rss_feeds) as Prisma.InputJsonValue }
            : {}),
          updated_at: now,
        },
        select: BOT_WITH_USER_SELECT,
      });
    });

    const payload: BotUpdateResponse = {
      bot: await toBotDetail(bot, authResult.user_id),
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("bot_update_failed", error);
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
      { error: { code: "bot_update_failed", message: "Failed to update bot." } },
      { status: 500 },
    );
  }
}
