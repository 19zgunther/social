import type {
  GameScoreScope,
  GameScoreSubmitResponse,
  GameScoresLeaderboardResponse,
} from "@/app/types/interfaces";
import { reportClientError } from "@/app/lib/errorReport";

export const TETRIS_GAME = "tetris";
export const TETRIS_LEVEL = "global";

const LEGACY_LOCAL_KEY = "social_tetris_high_scores";

/** Drop old local-only high scores once; DB is the source of truth now. */
export function clearLegacyLocalTetrisScores(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LEGACY_LOCAL_KEY);
  } catch {
    // ignore
  }
}

export async function submitTetrisScore(score: number): Promise<GameScoreSubmitResponse | null> {
  if (!Number.isInteger(score) || score < 0) return null;
  try {
    const response = await fetch("/api/game-score-submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ game: TETRIS_GAME, level: TETRIS_LEVEL, score }),
      keepalive: true,
    });
    if (!response.ok) {
      if (response.status !== 409) {
        reportClientError(
          "game_score_submit_client",
          new Error(`game-score-submit HTTP ${response.status}`),
          { game: TETRIS_GAME, level: TETRIS_LEVEL, score, httpStatus: response.status },
        );
      }
      return null;
    }
    return (await response.json()) as GameScoreSubmitResponse;
  } catch (error) {
    reportClientError("game_score_submit_client", error, {
      game: TETRIS_GAME,
      level: TETRIS_LEVEL,
      score,
    });
    return null;
  }
}

export async function fetchTetrisLeaderboard(
  scope: GameScoreScope,
): Promise<GameScoresLeaderboardResponse | null> {
  try {
    const response = await fetch("/api/game-scores-leaderboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ game: TETRIS_GAME, level: TETRIS_LEVEL, scope, limit: 25 }),
    });
    if (!response.ok) return null;
    return (await response.json()) as GameScoresLeaderboardResponse;
  } catch {
    return null;
  }
}
