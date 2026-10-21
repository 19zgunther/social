import { getSignedMainBucketImageUrl } from "@/app/api/server_file_storage_utils";
import { BotDetail, BotWakePeriod } from "@/app/types/interfaces";

export const MAX_BOTS_PER_USER = 3;

export const DEFAULT_BOT_SYSTEM_PROMPT =
  "You are a personal AI & software startup news bot. Once woken, use list_my_posts to see what you already posted, fetch configured RSS feeds, pick the most interesting recent stories you have not covered yet, and create one short text post summarizing them with links. Keep it concise and factual. Put longer detail or extra sources in a :::collapse section.";

export function isBotWakePeriod(value: string): value is BotWakePeriod {
  return value === "24h" || value === "1w";
}

export const DEFAULT_WAKE_TIME = "13:00";
export const DEFAULT_WAKE_WEEKDAY = 1;
export const DEFAULT_WAKE_TIMEZONE = "UTC";

const WAKE_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isBotWakeTime(value: unknown): value is string {
  return typeof value === "string" && WAKE_TIME_RE.test(value);
}

export function isBotWakeWeekday(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 6;
}

export function isBotWakeTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Civil day number (days since epoch, in `timeZone`) + minutes since local midnight. */
function localDayAndMinutes(date: Date, timeZone: string): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  let year = 0;
  let month = 0;
  let dayOfMonth = 0;
  let hour = 0;
  let minute = 0;
  for (const part of parts) {
    if (part.type === "year") year = Number(part.value);
    else if (part.type === "month") month = Number(part.value);
    else if (part.type === "day") dayOfMonth = Number(part.value);
    else if (part.type === "hour") hour = Number(part.value);
    else if (part.type === "minute") minute = Number(part.value);
  }
  return {
    day: Math.floor(Date.UTC(year, month - 1, dayOfMonth) / DAY_MS),
    minutes: hour * 60 + minute,
  };
}

export type BotWakeSchedule = {
  wake_period: string;
  wake_time: string;
  wake_weekday: number;
  wake_timezone: string;
  last_woke_at: Date | null;
};

/**
 * A bot is due when its most recent scheduled local occurrence (daily at
 * `wake_time`, or weekly on `wake_weekday` at `wake_time`, in
 * `wake_timezone`) has passed and it hasn't woken on that local day yet.
 * Missed occurrences are caught up once at the next check.
 */
export function isBotDueAt(now: Date, schedule: BotWakeSchedule): boolean {
  const timeZone = isBotWakeTimezone(schedule.wake_timezone)
    ? schedule.wake_timezone
    : DEFAULT_WAKE_TIMEZONE;
  const wakeMinutes = isBotWakeTime(schedule.wake_time)
    ? Number(schedule.wake_time.slice(0, 2)) * 60 + Number(schedule.wake_time.slice(3, 5))
    : 13 * 60;
  const wakeWeekday = isBotWakeWeekday(schedule.wake_weekday)
    ? schedule.wake_weekday
    : DEFAULT_WAKE_WEEKDAY;

  const nowLocal = localDayAndMinutes(now, timeZone);
  let scheduledDay = nowLocal.day;
  if (schedule.wake_period === "1w") {
    const todayWeekday = new Date(nowLocal.day * DAY_MS).getUTCDay();
    scheduledDay -= (todayWeekday - wakeWeekday + 7) % 7;
    if (scheduledDay === nowLocal.day && nowLocal.minutes < wakeMinutes) {
      scheduledDay -= 7;
    }
  } else if (nowLocal.minutes < wakeMinutes) {
    scheduledDay -= 1;
  }

  if (!schedule.last_woke_at) {
    return true;
  }
  return localDayAndMinutes(schedule.last_woke_at, timeZone).day < scheduledDay;
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
  owner_id: string;
  system_prompt: string;
  description: string;
  is_private: boolean | null;
  wake_period: string;
  wake_time: string;
  wake_weekday: number;
  wake_timezone: string;
  rss_feeds: unknown;
  last_woke_at: Date | null;
  created_at: Date;
  updated_at: Date;
  users_bot: {
    username: string;
    profile_image_id: string | null;
  };
  users_owner: {
    id: string;
    username: string;
  };
};

export async function toBotDetail(
  bot: BotRowWithUser,
  viewerUserId: string,
): Promise<BotDetail> {
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
    description: bot.description,
    is_private: bot.is_private,
    wake_period: wakePeriod,
    wake_time: isBotWakeTime(bot.wake_time) ? bot.wake_time : DEFAULT_WAKE_TIME,
    wake_weekday: isBotWakeWeekday(bot.wake_weekday) ? bot.wake_weekday : DEFAULT_WAKE_WEEKDAY,
    wake_timezone: isBotWakeTimezone(bot.wake_timezone) ? bot.wake_timezone : DEFAULT_WAKE_TIMEZONE,
    rss_feeds: parseRssFeedsJson(bot.rss_feeds),
    last_woke_at: bot.last_woke_at?.toISOString() ?? null,
    created_at: bot.created_at.toISOString(),
    updated_at: bot.updated_at.toISOString(),
    owner_user_id: bot.users_owner.id,
    owner_username: bot.users_owner.username,
    is_owner: bot.owner_id === viewerUserId,
  };
}

export const BOT_WITH_USER_SELECT = {
  id: true,
  user_id: true,
  owner_id: true,
  system_prompt: true,
  description: true,
  is_private: true,
  wake_period: true,
  wake_time: true,
  wake_weekday: true,
  wake_timezone: true,
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
  users_owner: {
    select: {
      id: true,
      username: true,
    },
  },
} as const;
