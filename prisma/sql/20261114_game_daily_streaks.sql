-- Work Golf Daily Challenge: tag daily scores + per-game streak progress.
-- Review only — apply manually / via your usual SQL path.

ALTER TABLE "game_scores"
  ADD COLUMN IF NOT EXISTS "daily_day" DATE;

CREATE UNIQUE INDEX IF NOT EXISTS "game_scores_user_id_game_daily_day_key"
  ON "game_scores" ("user_id", "game", "daily_day")
  WHERE "daily_day" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "game_scores_game_daily_day_score_idx"
  ON "game_scores" ("game", "daily_day", "score" DESC);

CREATE TABLE IF NOT EXISTS "game_streaks" (
  "user_id" UUID NOT NULL,
  "game" TEXT NOT NULL,
  "day_streak" INTEGER NOT NULL DEFAULT 0,
  "max_day_streak" INTEGER NOT NULL DEFAULT 0,
  "first_day_in_streak" DATE,
  "most_recent_day_in_streak" DATE,
  CONSTRAINT "game_streaks_pkey" PRIMARY KEY ("user_id", "game"),
  CONSTRAINT "game_streaks_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "game_streaks_game_day_streak_idx"
  ON "game_streaks" ("game", "day_streak" DESC);

CREATE INDEX IF NOT EXISTS "game_streaks_game_max_day_streak_idx"
  ON "game_streaks" ("game", "max_day_streak" DESC);
