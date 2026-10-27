import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/app/lib/prisma";
import { loadAcceptedFriendIds } from "@/app/lib/acceptedFriendIds";
import type { GameScoreLeaderboardEntry, GameScoreScope } from "@/app/types/interfaces";

export const TETRIS_GAME_ID = "tetris";
export const TETRIS_LEVEL_ID = "global";
export const WORK_GOLF_GAME_ID = "work-golf";

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
        ${filter}
      ORDER BY gs.user_id, gs.score DESC, gs.created_at ASC
    ) best
    INNER JOIN users u ON u.id = best.user_id
    ORDER BY best.score DESC, best.created_at ASC, best.user_id ASC
  `;

  return rows;
}

export async function insertGameScore(args: {
  userId: string;
  game: string;
  level: string;
  score: number;
}): Promise<{
  id: string;
  created_at: Date;
  run_rank: number;
  personal_best: number;
  personal_best_rank: number;
}> {
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
  };
}

/** Distinct level ids this user has at least one score for (finished rounds). */
export async function loadPlayedLevels(args: {
  userId: string;
  game: string;
}): Promise<string[]> {
  const rows = await prisma.game_scores.findMany({
    where: { user_id: args.userId, game: args.game },
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
}): Promise<{
  top: GameScoreLeaderboardEntry[];
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

  const top = bests.slice(0, 3).map((row) => ({
    user_id: row.user_id,
    username: row.username,
    score: row.score,
    created_at: row.created_at.toISOString(),
  }));

  const myIndex = bests.findIndex((row) => row.user_id === args.userId);
  const mine = myIndex >= 0 ? bests[myIndex]! : null;

  return {
    top,
    me: {
      user_id: args.userId,
      username: args.username,
      personal_best: mine?.score ?? null,
      rank: mine ? myIndex + 1 : null,
    },
  };
}
