-- Client/server error capture for debugging (e.g. failed post create).
-- Review only — apply manually / via your usual SQL path.

CREATE TABLE IF NOT EXISTS "error_log" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "user_id" UUID NOT NULL,
  "user_name" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  CONSTRAINT "error_log_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "error_log_created_at_idx"
  ON "error_log" ("created_at" DESC);

CREATE INDEX IF NOT EXISTS "error_log_user_id_created_at_idx"
  ON "error_log" ("user_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "error_log_key_created_at_idx"
  ON "error_log" ("key", "created_at" DESC);
