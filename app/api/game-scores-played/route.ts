import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { loadPlayedLevels, normalizeGameId } from "@/app/lib/gameScores";
import type { GameScoresPlayedRequest, GameScoresPlayedResponse } from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as GameScoresPlayedRequest;
    const game = normalizeGameId(body.game);
    if (!game) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "game is required.",
          },
        },
        { status: 400 },
      );
    }

    const levels = await loadPlayedLevels({
      userId: authResult.user_id,
      game,
    });

    const payload: GameScoresPlayedResponse = { game, levels };
    return NextResponse.json(payload);
  } catch (error) {
    console.error("game_scores_played_failed", error);
    return NextResponse.json(
      { error: { code: "internal_error", message: "Failed to load played levels." } },
      { status: 500 },
    );
  }
}
