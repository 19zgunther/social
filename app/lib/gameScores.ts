import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/app/lib/prisma";
import { loadAcceptedFriendIds } from "@/app/lib/acceptedFriendIds";
import {
  dateStringToDate,
  dateToDateString,
  easternDateString,
  previousEasternDateString,
} from "@/app/lib/easternDate";
import type {
  GameScoreLeaderboardEntry,
  GameScoreScope,
  GameStreakKind,
  GameStreakLeaderboardEntry,
} from "@/app/types/interfaces";

export const TETRIS_GAME_ID = "tetris";
export const TETRIS_LEVEL_ID = "global";
export const WORK_GOLF_GAME_ID = "work-golf";
export const WORK_GOLF_DAILY_LEVEL_ID = "daily";
export const SPACE_INVADERS_GAME_ID = "space-invaders";
export const SPACE_INVADERS_LEVEL_ID = "global";

const MAX_SCORE = 100_000_000;

export function normalizeGameId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const game = raw.trim().toLowerCase();
  if (!game || game.length > 64 || !/^[a-z0-9_-]+$/.test(game)) return null;
  return game;
}

export function normalizeLevelId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const level = raw.trim().toLowerCase();
  if (!level || level.length > 64 || !/^[a-z0-9_-]+$/.test(level)) return null;
  return level;
}

export function normalizeScore(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > MAX_SCORE) {
    return null;
  }
  return raw;
}

type BestRow = {
  user_id: string;
  username: string;
  score: number;
  created_at: Date;
};

async function loadPersonalBests(args: {
  game: string;
  level: string;
  userIds: string[] | null;
}): Promise<BestRow[]> {
  if (args.userIds && args.userIds.length === 0) return [];

  const filter =
    args.userIds === null
      ? Prisma.sql``
      : Prisma.sql`AND gs.user_id IN (${Prisma.join(args.userIds.map((id) => Prisma.sql`${id}::uuid`))})`;

  const rows = await prisma.$queryRaw<BestRow[]>`
    SELECT
      best.user_id,
      u.username,
      best.score,
      best.created_at
    FROM (
      SELECT DISTINCT ON (gs.user_id)
        gs.user_id,
        gs.score,
        gs.created_at
      FROM game_scores gs
      WHERE gs.game = ${args.game}
        AND gs.level = ${args.level}
        AND gs.daily_day IS NULL
        ${filter}
      ORDER BY gs.user_id, gs.score DESC, gs.created_at ASC
    ) best
    INNER JOIN users u ON u.id = best.user_id
    ORDER BY best.score DESC, best.created_at ASC, best.user_id ASC
  `;

  return rows;
}

export type GameStreakInfo = {
  day_streak: number;
  max_day_streak: number;
  first_day_in_streak: string | null;
  most_recent_day_in_streak: string | null;
};

function streakInfoFromRow(row: {
  day_streak: number;
  max_day_streak: number;
  first_day_in_streak: Date | null;
  most_recent_day_in_streak: Date | null;
} | null): GameStreakInfo {
  if (!row) {
    return {
      day_streak: 0,
      max_day_streak: 0,
      first_day_in_streak: null,
      most_recent_day_in_streak: null,
    };
  }
  return {
    day_streak: row.day_streak,
    max_day_streak: row.max_day_streak,
    first_day_in_streak: row.first_day_in_streak
      ? dateToDateString(row.first_day_in_streak)
      : null,
    most_recent_day_in_streak: row.most_recent_day_in_streak
      ? dateToDateString(row.most_recent_day_in_streak)
      : null,
  };
}

/** Apply daily play to streak row; returns updated streak info. */
async function upsertDailyStreak(args: {
  userId: string;
  game: string;
  today: string;
}): Promise<GameStreakInfo> {
  const todayDate = dateStringToDate(args.today);
  const yesterday = previousEasternDateString(args.today);
  const existing = await prisma.game_streaks.findUnique({
    where: { user_id_game: { user_id: args.userId, game: args.game } },
  });

  if (existing?.most_recent_day_in_streak) {
    const mostRecent = dateToDateString(existing.most_recent_day_in_streak);
    if (mostRecent === args.today) {
      return streakInfoFromRow(existing);
    }
    if (mostRecent === yesterday) {
      const dayStreak = existing.day_streak + 1;
      const maxDayStreak = Math.max(existing.max_day_streak, dayStreak);
      const updated = await prisma.game_streaks.update({
        where: { user_id_game: { user_id: args.userId, game: args.game } },
        data: {
          day_streak: dayStreak,
          max_day_streak: maxDayStreak,
          most_recent_day_in_streak: todayDate,
        },
      });
      return streakInfoFromRow(updated);
    }
  }

  const updated = await prisma.game_streaks.upsert({
    where: { user_id_game: { user_id: args.userId, game: args.game } },
    create: {
      user_id: args.userId,
      game: args.game,
      day_streak: 1,
      max_day_streak: Math.max(1, existing?.max_day_streak ?? 0),
      first_day_in_streak: todayDate,
      most_recent_day_in_streak: todayDate,
    },
    update: {
      day_streak: 1,
      max_day_streak: Math.max(1, existing?.max_day_streak ?? 0),
      first_day_in_streak: todayDate,
      most_recent_day_in_streak: todayDate,
    },
  });
  return streakInfoFromRow(updated);
}

export async function insertGameScore(args: {
  userId: string;
  game: string;
  level: string;
  score: number;
  daily?: boolean;
}): Promise<{
  id: string;
  created_at: Date;
  run_rank: number;
  personal_best: number;
  personal_best_rank: number;
  daily_day: string | null;
  streak: GameStreakInfo | null;
}> {
  if (args.daily) {
    const today = easternDateString();
    const todayDate = dateStringToDate(today);

    const already = await prisma.game_scores.findFirst({
      where: {
        user_id: args.userId,
        game: args.game,
        daily_day: todayDate,
      },
      select: { id: true },
    });
    if (already) {
      const err = new Error("daily_already_played");
      err.name = "DailyAlreadyPlayedError";
      throw err;
    }

    const row = await prisma.game_scores.create({
      data: {
        user_id: args.userId,
        game: args.game,
        level: WORK_GOLF_DAILY_LEVEL_ID,
        score: args.score,
        daily_day: todayDate,
      },
      select: { id: true, created_at: true, score: true },
    });

    const streak = await upsertDailyStreak({
      userId: args.userId,
      game: args.game,
      today,
    });

    const dayBoard = await loadDailyLeaderboard({
      userId: args.userId,
      username: "",
      game: args.game,
      dailyDay: today,
      scope: "all",
      limit: 50,
    });

    return {
      id: row.id,
      created_at: row.created_at,
      run_rank: dayBoard.me.rank ?? 1,
      personal_best: args.score,
      personal_best_rank: dayBoard.me.rank ?? 1,
      daily_day: today,
      streak,
    };
  }

  const row = await prisma.game_scores.create({
    data: {
      user_id: args.userId,
      game: args.game,
      level: args.level,
      score: args.score,
    },
    select: { id: true, created_at: true, score: true },
  });

  const betterRuns = await prisma.game_scores.count({
    where: {
      game: args.game,
      level: args.level,
      daily_day: null,
      OR: [
        { score: { gt: args.score } },
        { score: args.score, created_at: { lt: row.created_at } },
        { score: args.score, created_at: row.created_at, id: { lt: row.id } },
      ],
    },
  });

  const bests = await loadPersonalBests({
    game: args.game,
    level: args.level,
    userIds: null,
  });
  const mine = bests.find((b) => b.user_id === args.userId);
  const personalBest = mine?.score ?? args.score;
  const personalBestRank = bests.findIndex((b) => b.user_id === args.userId) + 1;

  return {
    id: row.id,
    created_at: row.created_at,
    run_rank: betterRuns + 1,
    personal_best: personalBest,
    personal_best_rank: personalBestRank > 0 ? personalBestRank : 1,
    daily_day: null,
    streak: null,
  };
}

/** Distinct free-play level ids this user has finished (excludes daily rows). */
export async function loadPlayedLevels(args: {
  userId: string;
  game: string;
}): Promise<string[]> {
  const rows = await prisma.game_scores.findMany({
    where: { user_id: args.userId, game: args.game, daily_day: null },
    distinct: ["level"],
    select: { level: true },
    orderBy: { level: "asc" },
  });
  return rows.map((r) => r.level);
}

export async function loadGameLeaderboard(args: {
  userId: string;
  username: string;
  game: string;
  level: string;
  scope: GameScoreScope;
  limit?: number;
}): Promise<{
  top: GameScoreLeaderboardEntry[];
  total: number;
  me: {
    user_id: string;
    username: string;
    personal_best: number | null;
    rank: number | null;
  };
}> {
  let userIds: string[] | null = null;
  if (args.scope === "friends") {
    const friendIds = await loadAcceptedFriendIds(args.userId);
    friendIds.add(args.userId);
    userIds = [...friendIds];
  }

  const bests = await loadPersonalBests({
    game: args.game,
    level: args.level,
    userIds,
  });

  const limit = Math.max(1, Math.min(50, Math.floor(args.limit ?? 20)));
  const top = bests.slice(0, limit).map((row, i) => ({
    user_id: row.user_id,
    username: row.username,
    score: row.score,
    created_at: row.created_at.toISOString(),
    rank: i + 1,
  }));

  const myIndex = bests.findIndex((row) => row.user_id === args.userId);
  const mine = myIndex >= 0 ? bests[myIndex]! : null;

  return {
    top,
    total: bests.length,
    me: {
      user_id: args.userId,
      username: args.username,
      personal_best: mine?.score ?? null,
      rank: mine ? myIndex + 1 : null,
    },
  };
}

export async function loadDailyLeaderboard(args: {
  userId: string;
  username: string;
  game: string;
  dailyDay: string;
  scope: GameScoreScope;
  limit?: number;
}): Promise<{
  top: GameScoreLeaderboardEntry[];
  total: number;
  me: {
    user_id: string;
    username: string;
    personal_best: number | null;
    rank: number | null;
  };
}> {
  let userIds: string[] | null = null;
  if (args.scope === "friends") {
    const friendIds = await loadAcceptedFriendIds(args.userId);
    friendIds.add(args.userId);
    userIds = [...friendIds];
  }

  if (userIds && userIds.length === 0) {
    return {
      top: [],
      total: 0,
      me: {
        user_id: args.userId,
        username: args.username,
        personal_best: null,
        rank: null,
      },
    };
  }

  const dayDate = dateStringToDate(args.dailyDay);
  const filter =
    userIds === null
      ? Prisma.sql``
      : Prisma.sql`AND gs.user_id IN (${Prisma.join(userIds.map((id) => Prisma.sql`${id}::uuid`))})`;

  const rows = await prisma.$queryRaw<BestRow[]>`
    SELECT
      gs.user_id,
      u.username,
      gs.score,
      gs.created_at
    FROM game_scores gs
    INNER JOIN users u ON u.id = gs.user_id
    WHERE gs.game = ${args.game}
      AND gs.daily_day = ${dayDate}::date
      ${filter}
    ORDER BY gs.score DESC, gs.created_at ASC, gs.user_id ASC
  `;

  const limit = Math.max(1, Math.min(50, Math.floor(args.limit ?? 20)));
  const top = rows.slice(0, limit).map((row, i) => ({
    user_id: row.user_id,
    username: row.username,
    score: row.score,
    created_at: row.created_at.toISOString(),
    rank: i + 1,
  }));

  const myIndex = rows.findIndex((row) => row.user_id === args.userId);
  const mine = myIndex >= 0 ? rows[myIndex]! : null;

  return {
    top,
    total: rows.length,
    me: {
      user_id: args.userId,
      username: args.username,
      personal_best: mine?.score ?? null,
      rank: mine ? myIndex + 1 : null,
    },
  };
}

export async function loadGameStreak(args: {
  userId: string;
  game: string;
}): Promise<GameStreakInfo> {
  const row = await prisma.game_streaks.findUnique({
    where: { user_id_game: { user_id: args.userId, game: args.game } },
  });
  return streakInfoFromRow(row);
}

export async function loadDailyStatus(args: {
  userId: string;
  username: string;
  game: string;
}): Promise<{
  today: string;
  already_played: boolean;
  my_score: number | null;
  streak: GameStreakInfo;
  friends_played_today: number;
}> {
  const today = easternDateString();
  const todayDate = dateStringToDate(today);
  const myRow = await prisma.game_scores.findFirst({
    where: {
      user_id: args.userId,
      game: args.game,
      daily_day: todayDate,
    },
    select: { score: true },
  });

  const streak = await loadGameStreak({ userId: args.userId, game: args.game });
  const friendIds = await loadAcceptedFriendIds(args.userId);
  let friendsPlayedToday = 0;
  if (friendIds.size > 0) {
    friendsPlayedToday = await prisma.game_scores.count({
      where: {
        game: args.game,
        daily_day: todayDate,
        user_id: { in: [...friendIds] },
      },
    });
  }

  return {
    today,
    already_played: myRow != null,
    my_score: myRow?.score ?? null,
    streak,
    friends_played_today: friendsPlayedToday,
  };
}

export async function loadStreakLeaderboard(args: {
  userId: string;
  username: string;
  game: string;
  kind: GameStreakKind;
  scope: GameScoreScope;
  limit?: number;
}): Promise<{
  top: GameStreakLeaderboardEntry[];
  total: number;
  me: GameStreakLeaderboardEntry;
}> {
  const today = easternDateString();
  const yesterday = previousEasternDateString(today);
  const todayDate = dateStringToDate(today);
  const yesterdayDate = dateStringToDate(yesterday);

  let userIds: string[] | null = null;
  if (args.scope === "friends") {
    const friendIds = await loadAcceptedFriendIds(args.userId);
    friendIds.add(args.userId);
    userIds = [...friendIds];
  }

  const limit = Math.max(1, Math.min(50, Math.floor(args.limit ?? 20)));

  type StreakRow = {
    user_id: string;
    username: string;
    day_streak: number;
    max_day_streak: number;
    most_recent_day_in_streak: Date | null;
  };

  const userFilter =
    userIds === null
      ? Prisma.sql``
      : Prisma.sql`AND gs.user_id IN (${Prisma.join(userIds.map((id) => Prisma.sql`${id}::uuid`))})`;

  let rows: StreakRow[];
  if (args.kind === "current") {
    rows = await prisma.$queryRaw<StreakRow[]>`
      SELECT
        gs.user_id,
        u.username,
        gs.day_streak,
        gs.max_day_streak,
        gs.most_recent_day_in_streak
      FROM game_streaks gs
      INNER JOIN users u ON u.id = gs.user_id
      WHERE gs.game = ${args.game}
        AND gs.day_streak > 0
        AND gs.most_recent_day_in_streak IN (${todayDate}::date, ${yesterdayDate}::date)
        ${userFilter}
      ORDER BY gs.day_streak DESC, gs.most_recent_day_in_streak DESC, gs.user_id ASC
    `;
  } else {
    rows = await prisma.$queryRaw<StreakRow[]>`
      SELECT
        gs.user_id,
        u.username,
        gs.day_streak,
        gs.max_day_streak,
        gs.most_recent_day_in_streak
      FROM game_streaks gs
      INNER JOIN users u ON u.id = gs.user_id
      WHERE gs.game = ${args.game}
        AND gs.max_day_streak > 0
        ${userFilter}
      ORDER BY gs.max_day_streak DESC, gs.user_id ASC
    `;
  }

  const mapped: GameStreakLeaderboardEntry[] = rows.map((row, i) => ({
    user_id: row.user_id,
    username: row.username,
    streak: args.kind === "current" ? row.day_streak : row.max_day_streak,
    day_streak: row.day_streak,
    max_day_streak: row.max_day_streak,
    most_recent_day_in_streak: row.most_recent_day_in_streak
      ? dateToDateString(row.most_recent_day_in_streak)
      : null,
    rank: i + 1,
  }));

  const top = mapped.slice(0, limit);
  const myIndex = mapped.findIndex((row) => row.user_id === args.userId);
  const me: GameStreakLeaderboardEntry =
    myIndex >= 0
      ? mapped[myIndex]!
      : {
          user_id: args.userId,
          username: args.username,
          streak: 0,
          day_streak: 0,
          max_day_streak: 0,
          most_recent_day_in_streak: null,
          rank: 0,
        };

  return {
    top,
    total: mapped.length,
    me,
  };
}
