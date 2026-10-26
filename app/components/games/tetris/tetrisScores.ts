export type TetrisHighScore = {
  score: number;
  level: number;
  lines: number;
  at: string;
};

export const TETRIS_HIGH_SCORES_KEY = "social_tetris_high_scores";
export const TETRIS_HIGH_SCORES_MAX = 10;

export function readTetrisHighScores(): TetrisHighScore[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(TETRIS_HIGH_SCORES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((row): row is TetrisHighScore => {
        if (!row || typeof row !== "object") return false;
        const r = row as Record<string, unknown>;
        return (
          typeof r.score === "number" &&
          typeof r.level === "number" &&
          typeof r.lines === "number" &&
          typeof r.at === "string"
        );
      })
      .sort((a, b) => b.score - a.score || b.at.localeCompare(a.at))
      .slice(0, TETRIS_HIGH_SCORES_MAX);
  } catch {
    return [];
  }
}

export function writeTetrisHighScores(scores: TetrisHighScore[]): void {
  if (typeof window === "undefined") return;
  try {
    const sorted = [...scores]
      .sort((a, b) => b.score - a.score || b.at.localeCompare(a.at))
      .slice(0, TETRIS_HIGH_SCORES_MAX);
    window.localStorage.setItem(TETRIS_HIGH_SCORES_KEY, JSON.stringify(sorted));
  } catch {
    // ignore quota / private mode
  }
}

export function clearTetrisHighScores(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(TETRIS_HIGH_SCORES_KEY);
  } catch {
    // ignore
  }
}

/** Returns the new list and whether the run was inserted. */
export function tryAddTetrisHighScore(entry: Omit<TetrisHighScore, "at"> & { at?: string }): {
  scores: TetrisHighScore[];
  madeList: boolean;
  rank: number | null;
} {
  const nextEntry: TetrisHighScore = {
    score: entry.score,
    level: entry.level,
    lines: entry.lines,
    at: entry.at ?? new Date().toISOString(),
  };
  const existing = readTetrisHighScores();
  const qualifies =
    existing.length < TETRIS_HIGH_SCORES_MAX ||
    nextEntry.score > (existing[existing.length - 1]?.score ?? 0);

  if (!qualifies && existing.length >= TETRIS_HIGH_SCORES_MAX) {
    return { scores: existing, madeList: false, rank: null };
  }

  const merged = [...existing, nextEntry]
    .sort((a, b) => b.score - a.score || b.at.localeCompare(a.at))
    .slice(0, TETRIS_HIGH_SCORES_MAX);
  writeTetrisHighScores(merged);
  const rank = merged.findIndex(
    (row) =>
      row.score === nextEntry.score &&
      row.level === nextEntry.level &&
      row.lines === nextEntry.lines &&
      row.at === nextEntry.at,
  );
  return {
    scores: merged,
    madeList: rank >= 0,
    rank: rank >= 0 ? rank + 1 : null,
  };
}
