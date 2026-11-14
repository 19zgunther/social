import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { easternDateString } from "@/app/lib/easternDate";
import {
  loadDailyLeaderboard,
  loadGameStreak,
  normalizeGameId,
} from "@/app/lib/gameScores";
import type {
  GameDailyLeaderboardRequest,
  GameDailyLeaderboardResponse,
  GameScoreScope,
} from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as GameDailyLeaderboardRequest;
    const game = normalizeGameId(body.game);
    const scope: GameScoreScope = body.scope === "friends" ? "friends" : "all";
    const dailyDay =
      typeof body.daily_day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.daily_day)
        ? body.daily_day
        : easternDateString();
    const limit =
      typeof body.limit === "number" && Number.isFinite(body.limit) ? body.limit : 20;

    if (!game) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "game is required." } },
        { status: 400 },
      );
    }

    const user = await prisma.users.findUnique({
      where: { id: authResult.user_id },
      select: { username: true },
    });
    if (!user) {
      return NextResponse.json(
        { error: { code: "not_found", message: "User not found." } },
        { status: 404 },
      );
    }

    const [board, streak] = await Promise.all([
      loadDailyLeaderboard({
        userId: authResult.user_id,
        username: user.username,
        game,
        dailyDay,
        scope,
        limit,
      }),
      loadGameStreak({ userId: authResult.user_id, game }),
    ]);

    const payload: GameDailyLeaderboardResponse = {
      game,
      daily_day: dailyDay,
      scope,
      top: board.top,
      total: board.total,
      me: board.me,
      streak,
    };
    return NextResponse.json(payload);
  } catch (error) {
    console.error("game_daily_leaderboard_failed", error);
    return NextResponse.json(
      { error: { code: "internal_error", message: "Failed to load daily leaderboard." } },
      { status: 500 },
    );
  }
}
