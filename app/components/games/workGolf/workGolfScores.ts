import type {
  GameScoreScope,
  GameScoreSubmitResponse,
  GameScoresLeaderboardResponse,
} from "@/app/types/interfaces";
import { WORK_GOLF_GAME, levelIdForNumber } from "./workGolfEngine";

export { WORK_GOLF_GAME };

export async function submitWorkGolfScore(
  levelNumber: number,
  score: number,
): Promise<GameScoreSubmitResponse | null> {
  if (!Number.isInteger(score) || score < 0) return null;
  try {
    const response = await fetch("/api/game-score-submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        game: WORK_GOLF_GAME,
        level: levelIdForNumber(levelNumber),
        score,
      }),
      keepalive: true,
    });
    if (!response.ok) return null;
    return (await response.json()) as GameScoreSubmitResponse;
  } catch {
    return null;
  }
}

export async function fetchWorkGolfLeaderboard(
  levelNumber: number,
  scope: GameScoreScope,
  limit = 25,
): Promise<GameScoresLeaderboardResponse | null> {
  try {
    const response = await fetch("/api/game-scores-leaderboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        game: WORK_GOLF_GAME,
        level: levelIdForNumber(levelNumber),
        scope,
        limit,
      }),
    });
    if (!response.ok) return null;
    return (await response.json()) as GameScoresLeaderboardResponse;
  } catch {
    return null;
  }
}

export async function fetchWorkGolfPlayedLevels(): Promise<number[]> {
  try {
    const response = await fetch("/api/game-scores-played", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ game: WORK_GOLF_GAME }),
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { levels?: string[] };
    const nums: number[] = [];
    for (const id of data.levels ?? []) {
      const n = Number(id);
      if (Number.isInteger(n) && n >= 1) nums.push(n);
    }
    return nums;
  } catch {
    return [];
  }
}

/** Level 1 always unlocked; otherwise next after highest finished. */
export function computeUnlockedMax(playedLevels: number[]): number {
  if (playedLevels.length === 0) return 1;
  const maxPlayed = Math.max(...playedLevels);
  return maxPlayed + 1;
}

export function isLevelUnlocked(level: number, playedLevels: number[]): boolean {
  if (level < 1) return false;
  if (level === 1) return true;
  if (playedLevels.includes(level)) return true;
  return level <= computeUnlockedMax(playedLevels);
}
