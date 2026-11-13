-- Parallel S3 + Supabase: registry of which backend owns each media UUID.
-- Missing row ⇒ treat as historical Supabase Storage.
-- Review only — apply manually / via your usual SQL path.

CREATE TABLE IF NOT EXISTS "storage_objects" (
  "id" UUID PRIMARY KEY,
  "backend" TEXT NOT NULL,
  "path_kind" TEXT NOT NULL,
  "owner_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "storage_objects_owner_id_idx"
  ON "storage_objects" ("owner_id");
