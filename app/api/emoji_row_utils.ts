/** Prefer `updated_at`; fall back to `created_at` for legacy/null rows if ever present. */
export const emojiUpdatedAtIso = (row: {
  created_at: Date;
  updated_at: Date | null;
}): string => row.updated_at?.toISOString() ?? row.created_at.toISOString();

export const emojiUpdatedAtMs = (row: {
  created_at: Date;
  updated_at: Date | null;
}): number => (row.updated_at ?? row.created_at).getTime();
