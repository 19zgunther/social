-- If you already applied 20261114_error_log.sql with NOT NULL user_id, run this.
-- Safe no-op if user_id is already nullable.

ALTER TABLE "error_log"
  ALTER COLUMN "user_id" DROP NOT NULL;
