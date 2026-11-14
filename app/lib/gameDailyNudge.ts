import { prisma } from "@/app/lib/prisma";
import { loadAcceptedFriendIds } from "@/app/lib/acceptedFriendIds";
import {
  dateStringToDate,
  easternDateString,
  easternHour,
  previousEasternDateString,
} from "@/app/lib/easternDate";
import { WORK_GOLF_GAME_ID } from "@/app/lib/gameScores";
import { sendPushToUsers } from "@/app/lib/push_notifications";

export type DailyNudgeResult = {
  ran: boolean;
  reason?: string;
  today: string;
  candidates: number;
  notified: number;
};

/**
 * Noon ET streak reminder: users who played yesterday (active streak) but not today.
 * Safe to call from a cron that may fire at 16:00 and 17:00 UTC — only runs when
 * America/New_York hour is 12.
 */
export async function runWorkGolfDailyNudge(
  now: Date = new Date(),
): Promise<DailyNudgeResult> {
  const today = easternDateString(now);
  if (easternHour(now) !== 12) {
    return {
      ran: false,
      reason: "not_noon_et",
      today,
      candidates: 0,
      notified: 0,
    };
  }

  const yesterday = previousEasternDateString(today);
  const yesterdayDate = dateStringToDate(yesterday);
  const todayDate = dateStringToDate(today);

  const streakHolders = await prisma.game_streaks.findMany({
    where: {
      game: WORK_GOLF_GAME_ID,
      day_streak: { gt: 0 },
      most_recent_day_in_streak: yesterdayDate,
    },
    select: { user_id: true },
  });

  if (streakHolders.length === 0) {
    return { ran: true, today, candidates: 0, notified: 0 };
  }

  const playedToday = await prisma.game_scores.findMany({
    where: {
      game: WORK_GOLF_GAME_ID,
      daily_day: todayDate,
      user_id: { in: streakHolders.map((row) => row.user_id) },
    },
    select: { user_id: true },
  });
  const playedSet = new Set(playedToday.map((row) => row.user_id));
  const candidates = streakHolders
    .map((row) => row.user_id)
    .filter((id) => !playedSet.has(id));

  let notified = 0;
  for (const userId of candidates) {
    const friendIds = await loadAcceptedFriendIds(userId);
    let friendsPlayed = 0;
    if (friendIds.size > 0) {
      friendsPlayed = await prisma.game_scores.count({
        where: {
          game: WORK_GOLF_GAME_ID,
          daily_day: todayDate,
          user_id: { in: [...friendIds] },
        },
      });
    }

    const body =
      friendsPlayed >= 2
        ? `${friendsPlayed} friends have played! Keep your streak!`
        : "Play today's Work Golf Daily Challenge to keep your streak!";

    try {
      await sendPushToUsers({
        recipientUserIds: [userId],
        payload: {
          title: "Work Golf Daily",
          body,
          url: "/?tab=profile&subtab=games",
        },
      });
      notified += 1;
    } catch (error) {
      console.error("work_golf_daily_nudge_push_failed", userId, error);
    }
  }

  return {
    ran: true,
    today,
    candidates: candidates.length,
    notified,
  };
}
