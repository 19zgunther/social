-- Events: track album → normal post publish. Review/apply locally.

ALTER TABLE "thread_events"
  ADD COLUMN IF NOT EXISTS "published_post_id" UUID;
