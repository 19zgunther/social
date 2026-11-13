/**
 * Backfill posts.data.media from dead legacy fields (posts.image_id + data.other_image_ids).
 *
 * Default is dry-run (no writes). Pass --apply to persist.
 *
 *   npx tsx scripts/migratePostMediaFromLegacy.ts
 *   npx tsx scripts/migratePostMediaFromLegacy.ts --limit 20
 *   npx tsx scripts/migratePostMediaFromLegacy.ts --apply
 */
import "dotenv/config";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/app/lib/prisma";
import {
  buildMediaFromLegacyFields,
  postDataHasMedia,
} from "@/app/lib/postMedia";
import type { PostData } from "@/app/types/interfaces";

const parseArgs = (argv: string[]) => {
  let apply = false;
  let limit: number | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--limit") {
      const raw = argv[i + 1];
      const parsed = raw ? Number.parseInt(raw, 10) : NaN;
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--limit requires a positive integer.");
      }
      limit = parsed;
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(`Usage: npx tsx scripts/migratePostMediaFromLegacy.ts [--limit N] [--apply]

Default: dry-run (no DB writes).
  --limit N   Only process the first N posts (created_at desc)
  --apply     Persist data.media updates (does not clear image_id / other_image_ids)
`);
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return { apply, limit };
};

const asPostData = (raw: unknown): PostData => {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as PostData;
  }
  return {};
};

async function main() {
  const { apply, limit } = parseArgs(process.argv.slice(2));

  console.log(
    apply
      ? "=== APPLY mode — will write posts.data.media ==="
      : "=== DRY-RUN (default) — no DB writes ===",
  );
  if (limit != null) {
    console.log(`limit=${limit}`);
  }

  const posts = await prisma.posts.findMany({
    orderBy: [{ created_at: "desc" }, { id: "desc" }],
    ...(limit != null ? { take: limit } : {}),
    select: {
      id: true,
      image_id: true,
      data: true,
    },
  });

  let alreadyOk = 0;
  let empty = 0;
  let wouldMigrate = 0;
  let migrated = 0;
  let errors = 0;

  for (const post of posts) {
    try {
      const existingData = asPostData(post.data);
      if (postDataHasMedia(existingData)) {
        alreadyOk += 1;
        continue;
      }

      const media = buildMediaFromLegacyFields({
        imageId: post.image_id,
        otherImageIds: existingData.other_image_ids,
      });

      if (media.length === 0) {
        empty += 1;
        continue;
      }

      const nextData: PostData = {
        ...existingData,
        media,
      };

      console.log(
        JSON.stringify({
          post_id: post.id,
          legacy_image_id: post.image_id,
          legacy_other_image_ids: existingData.other_image_ids ?? null,
          planned_media: media,
        }),
      );

      wouldMigrate += 1;

      if (!apply) {
        continue;
      }

      await prisma.posts.update({
        where: { id: post.id },
        data: {
          data: nextData as Prisma.InputJsonValue,
        },
      });
      migrated += 1;
    } catch (error) {
      errors += 1;
      console.error("migrate_row_failed", post.id, error);
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        scanned: posts.length,
        already_ok: alreadyOk,
        empty,
        would_migrate: wouldMigrate,
        migrated: apply ? migrated : 0,
        errors,
      },
      null,
      2,
    ),
  );

  if (errors > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
    // pg pool in app/lib/prisma keeps the process alive otherwise
    process.exit(process.exitCode ?? 0);
  });
