-- Dev account switcher: link child/dev users to a primary account.
-- Review only — apply manually / via your usual SQL path.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "primary_user_id" UUID;

CREATE INDEX IF NOT EXISTS "users_primary_user_id_idx"
  ON "users" ("primary_user_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_primary_user_id_fkey'
  ) THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_primary_user_id_fkey"
      FOREIGN KEY ("primary_user_id") REFERENCES "users"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;
