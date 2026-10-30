import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import {
  loadGameLeaderboard,
  normalizeGameId,
  normalizeLevelId,
} from "@/app/lib/gameScores";
import type {
  GameScoreScope,
  GameScoresLeaderboardRequest,
  GameScoresLeaderboardResponse,
} from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as GameScoresLeaderboardRequest;
    const game = normalizeGameId(body.game);
    const level = normalizeLevelId(body.level);
    const scope: GameScoreScope = body.scope === "friends" ? "friends" : "all";
    const limit =
      typeof body.limit === "number" && Number.isFinite(body.limit)
        ? body.limit
        : 20;

    if (!game || !level) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "game and level are required.",
          },
        },
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

    const board = await loadGameLeaderboard({
      userId: authResult.user_id,
      username: user.username,
      game,
      level,
      scope,
      limit,
    });

    const payload: GameScoresLeaderboardResponse = {
      game,
      level,
      scope,
      top: board.top,
      total: board.total,
      me: board.me,
    };
    return NextResponse.json(payload);
  } catch (error) {
    console.error("game_scores_leaderboard_failed", error);
    return NextResponse.json(
      { error: { code: "internal_error", message: "Failed to load leaderboard." } },
      { status: 500 },
    );
  }
}
