import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { loadDailyStatus, normalizeGameId } from "@/app/lib/gameScores";
import type {
  GameDailyStatusRequest,
  GameDailyStatusResponse,
} from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as GameDailyStatusRequest;
    const game = normalizeGameId(body.game);
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

    const status = await loadDailyStatus({
      userId: authResult.user_id,
      username: user.username,
      game,
    });

    const payload: GameDailyStatusResponse = {
      game,
      today: status.today,
      already_played: status.already_played,
      my_score: status.my_score,
      streak: status.streak,
      friends_played_today: status.friends_played_today,
    };
    return NextResponse.json(payload);
  } catch (error) {
    console.error("game_daily_status_failed", error);
    return NextResponse.json(
      { error: { code: "internal_error", message: "Failed to load daily status." } },
      { status: 500 },
    );
  }
}
