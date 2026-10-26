import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import {
  insertGameScore,
  normalizeGameId,
  normalizeLevelId,
  normalizeScore,
} from "@/app/lib/gameScores";
import type { GameScoreSubmitRequest, GameScoreSubmitResponse } from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as GameScoreSubmitRequest;
    const game = normalizeGameId(body.game);
    const level = normalizeLevelId(body.level);
    const score = normalizeScore(body.score);

    if (!game || !level || score === null) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "game, level, and a non-negative integer score are required.",
          },
        },
        { status: 400 },
      );
    }

    const inserted = await insertGameScore({
      userId: authResult.user_id,
      game,
      level,
      score,
    });

    const payload: GameScoreSubmitResponse = {
      id: inserted.id,
      game,
      level,
      score,
      created_at: inserted.created_at.toISOString(),
      run_rank: inserted.run_rank,
      personal_best: inserted.personal_best,
      personal_best_rank: inserted.personal_best_rank,
    };
    return NextResponse.json(payload);
  } catch (error) {
    console.error("game_score_submit_failed", error);
    return NextResponse.json(
      { error: { code: "internal_error", message: "Failed to save score." } },
      { status: 500 },
    );
  }
}
