-- Event co-hosts (and future per-event roles).
-- Review only — apply manually / via your usual SQL path.

CREATE TABLE IF NOT EXISTS "user_thread_event_role" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "thread_event_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL,
  "created_by" UUID NOT NULL,
  CONSTRAINT "user_thread_event_role_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_thread_event_role_thread_event_id_user_id_role_key"
  ON "user_thread_event_role" ("thread_event_id", "user_id", "role");

CREATE INDEX IF NOT EXISTS "user_thread_event_role_thread_event_id_idx"
  ON "user_thread_event_role" ("thread_event_id");

CREATE INDEX IF NOT EXISTS "user_thread_event_role_user_id_idx"
  ON "user_thread_event_role" ("user_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_thread_event_role_thread_event_id_fkey'
  ) THEN
    ALTER TABLE "user_thread_event_role"
      ADD CONSTRAINT "user_thread_event_role_thread_event_id_fkey"
      FOREIGN KEY ("thread_event_id") REFERENCES "thread_events"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_thread_event_role_user_id_fkey'
  ) THEN
    ALTER TABLE "user_thread_event_role"
      ADD CONSTRAINT "user_thread_event_role_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_thread_event_role_created_by_fkey'
  ) THEN
    ALTER TABLE "user_thread_event_role"
      ADD CONSTRAINT "user_thread_event_role_created_by_fkey"
      FOREIGN KEY ("created_by") REFERENCES "users"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;
