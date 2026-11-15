/** Soft daily play cap — localStorage + local calendar day only. */

export const TETRIS_DAILY_LIMIT_MS = 30 * 60 * 1000;

const STORAGE_KEY = "social_tetris_daily_play";

type DailyPlayState = {
  date: string;
  ms: number;
};

function localDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function readState(): DailyPlayState {
  const today = localDateKey();
  if (typeof window === "undefined") return { date: today, ms: 0 };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { date: today, ms: 0 };
    const parsed = JSON.parse(raw) as { date?: unknown; ms?: unknown };
    if (typeof parsed.date !== "string" || typeof parsed.ms !== "number") {
      return { date: today, ms: 0 };
    }
    if (parsed.date !== today) return { date: today, ms: 0 };
    return { date: today, ms: Math.max(0, Math.floor(parsed.ms)) };
  } catch {
    return { date: today, ms: 0 };
  }
}

function writeState(state: DailyPlayState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota / private mode
  }
}

export function getTetrisPlayedMsToday(): number {
  return readState().ms;
}

export function isTetrisDailyLimitReached(): boolean {
  return getTetrisPlayedMsToday() >= TETRIS_DAILY_LIMIT_MS;
}

/** Accrue active play time. Returns total ms played today after the add. */
export function addTetrisPlayTime(deltaMs: number): number {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return getTetrisPlayedMsToday();
  const state = readState();
  const ms = Math.min(TETRIS_DAILY_LIMIT_MS + 60_000, state.ms + Math.floor(deltaMs));
  writeState({ date: localDateKey(), ms });
  return ms;
}

export function formatTetrisPlayRemaining(msPlayed: number = getTetrisPlayedMsToday()): string {
  const remaining = Math.max(0, TETRIS_DAILY_LIMIT_MS - msPlayed);
  const mins = Math.ceil(remaining / 60_000);
  if (mins <= 0) return "0 min";
  return `${mins} min`;
}
