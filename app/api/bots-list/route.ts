import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { getSignedMainBucketImageUrl } from "@/app/api/server_file_storage_utils";
import {
  DEFAULT_WAKE_TIME,
  DEFAULT_WAKE_TIMEZONE,
  DEFAULT_WAKE_WEEKDAY,
  isBotWakePeriod,
  isBotWakeTime,
  isBotWakeTimezone,
  isBotWakeWeekday,
} from "@/app/lib/bots/botHelpers";
import { prisma } from "@/app/lib/prisma";
import { BotListItem, BotsListResponse } from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const bots = await prisma.bots.findMany({
      where: { owner_id: authResult.user_id },
      orderBy: { created_at: "desc" },
      select: {
        id: true,
        user_id: true,
        wake_period: true,
        wake_time: true,
        wake_weekday: true,
        wake_timezone: true,
        last_woke_at: true,
        users_bot: {
          select: {
            username: true,
            profile_image_id: true,
          },
        },
      },
    });

    const items: BotListItem[] = [];
    for (const bot of bots) {
      let profileImageUrl: string | null = null;
      if (bot.users_bot.profile_image_id) {
        try {
          profileImageUrl = await getSignedMainBucketImageUrl({
            userId: bot.user_id,
            imageId: bot.users_bot.profile_image_id,
          });
        } catch (error) {
          console.error("bots_list_profile_image_sign_failed", bot.id, error);
        }
      }
      items.push({
        id: bot.id,
        user_id: bot.user_id,
        username: bot.users_bot.username,
        profile_image_id: bot.users_bot.profile_image_id,
        profile_image_url: profileImageUrl,
        wake_period: isBotWakePeriod(bot.wake_period) ? bot.wake_period : "24h",
        wake_time: isBotWakeTime(bot.wake_time) ? bot.wake_time : DEFAULT_WAKE_TIME,
        wake_weekday: isBotWakeWeekday(bot.wake_weekday) ? bot.wake_weekday : DEFAULT_WAKE_WEEKDAY,
        wake_timezone: isBotWakeTimezone(bot.wake_timezone) ? bot.wake_timezone : DEFAULT_WAKE_TIMEZONE,
        last_woke_at: bot.last_woke_at?.toISOString() ?? null,
      });
    }

    const payload: BotsListResponse = { bots: items };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("bots_list_failed", error);
    return NextResponse.json(
      { error: { code: "bots_list_failed", message: "Failed to list bots." } },
      { status: 500 },
    );
  }
}
