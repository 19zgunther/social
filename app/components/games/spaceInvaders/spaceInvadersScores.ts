import type {
  GameScoreScope,
  GameScoreSubmitResponse,
  GameScoresLeaderboardResponse,
} from "@/app/types/interfaces";
import { reportClientError } from "@/app/lib/errorReport";

export const SPACE_INVADERS_GAME = "space-invaders";
export const SPACE_INVADERS_LEVEL = "global";

export async function submitSpaceInvadersScore(
  score: number,
): Promise<GameScoreSubmitResponse | null> {
  if (!Number.isInteger(score) || score < 0) return null;
  try {
    const response = await fetch("/api/game-score-submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        game: SPACE_INVADERS_GAME,
        level: SPACE_INVADERS_LEVEL,
        score,
      }),
      keepalive: true,
    });
    if (!response.ok) {
      if (response.status !== 409) {
        reportClientError(
          "game_score_submit_client",
          new Error(`game-score-submit HTTP ${response.status}`),
          {
            game: SPACE_INVADERS_GAME,
            level: SPACE_INVADERS_LEVEL,
            score,
            httpStatus: response.status,
          },
        );
      }
      return null;
    }
    return (await response.json()) as GameScoreSubmitResponse;
  } catch (error) {
    reportClientError("game_score_submit_client", error, {
      game: SPACE_INVADERS_GAME,
      level: SPACE_INVADERS_LEVEL,
      score,
    });
    return null;
  }
}

export async function fetchSpaceInvadersLeaderboard(
  scope: GameScoreScope,
): Promise<GameScoresLeaderboardResponse | null> {
  try {
    const response = await fetch("/api/game-scores-leaderboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        game: SPACE_INVADERS_GAME,
        level: SPACE_INVADERS_LEVEL,
        scope,
        limit: 25,
      }),
    });
    if (!response.ok) return null;
    return (await response.json()) as GameScoresLeaderboardResponse;
  } catch {
    return null;
  }
}
