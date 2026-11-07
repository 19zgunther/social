-- Unify Events: extend thread_events; drop unused shared_posts system.
-- Review only — not applied / not pushed.
-- No data migration: shared posts were never really used.

ALTER TABLE "thread_events"
  ADD COLUMN IF NOT EXISTS "shared_post_data" JSON,
  ADD COLUMN IF NOT EXISTS "blind_reveal" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "close_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "release_at" TIMESTAMPTZ(6);

CREATE INDEX IF NOT EXISTS "thread_events_thread_id_idx" ON "thread_events" ("thread_id");
CREATE INDEX IF NOT EXISTS "thread_events_starts_at_idx" ON "thread_events" ("starts_at");
CREATE INDEX IF NOT EXISTS "thread_events_ends_at_idx" ON "thread_events" ("ends_at");
CREATE INDEX IF NOT EXISTS "thread_events_close_at_idx" ON "thread_events" ("close_at");
CREATE INDEX IF NOT EXISTS "thread_events_release_at_idx" ON "thread_events" ("release_at" DESC);

-- Drop shared posts (contributors first for FK).
DROP TABLE IF EXISTS "shared_posts_contributors";
DROP TABLE IF EXISTS "shared_posts";
