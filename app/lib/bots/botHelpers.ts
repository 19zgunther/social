import { getSignedMainBucketImageUrl } from "@/app/api/server_file_storage_utils";
import { BotDetail, BotWakePeriod } from "@/app/types/interfaces";

export const MAX_BOTS_PER_USER = 3;

export const DEFAULT_BOT_SYSTEM_PROMPT =
  "You are a personal AI & software startup news bot. Once woken, use list_my_posts to see what you already posted, fetch configured RSS feeds, pick the most interesting recent stories you have not covered yet, and create one short text post summarizing them with links. Keep it concise and factual.";

export function isBotWakePeriod(value: string): value is BotWakePeriod {
  return value === "24h" || value === "1w";
}

export function parseRssFeedsJson(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export type BotRowWithUser = {
  id: string;
  user_id: string;
  system_prompt: string;
  wake_period: string;
  rss_feeds: unknown;
  last_woke_at: Date | null;
  created_at: Date;
  updated_at: Date;
  users_bot: {
    username: string;
    profile_image_id: string | null;
  };
};

export async function toBotDetail(bot: BotRowWithUser): Promise<BotDetail> {
  let profileImageUrl: string | null = null;
  if (bot.users_bot.profile_image_id) {
    try {
      profileImageUrl = await getSignedMainBucketImageUrl({
        userId: bot.user_id,
        imageId: bot.users_bot.profile_image_id,
      });
    } catch (error) {
      console.error("bot_profile_image_sign_failed", bot.id, error);
    }
  }

  const wakePeriod: BotWakePeriod = isBotWakePeriod(bot.wake_period) ? bot.wake_period : "24h";

  return {
    id: bot.id,
    user_id: bot.user_id,
    username: bot.users_bot.username,
    profile_image_id: bot.users_bot.profile_image_id,
    profile_image_url: profileImageUrl,
    system_prompt: bot.system_prompt,
    wake_period: wakePeriod,
    rss_feeds: parseRssFeedsJson(bot.rss_feeds),
    last_woke_at: bot.last_woke_at?.toISOString() ?? null,
    created_at: bot.created_at.toISOString(),
    updated_at: bot.updated_at.toISOString(),
  };
}

export const BOT_WITH_USER_SELECT = {
  id: true,
  user_id: true,
  system_prompt: true,
  wake_period: true,
  rss_feeds: true,
  last_woke_at: true,
  created_at: true,
  updated_at: true,
  users_bot: {
    select: {
      username: true,
      profile_image_id: true,
    },
  },
} as const;
