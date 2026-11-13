import { prisma } from "@/app/lib/prisma";

export type StorageBackend = "s3" | "supabase";
export type StoragePathKind = "user" | "thread";

/** Missing registry row ⇒ historical Supabase object. */
export const resolveStorageBackends = async (
  ids: Array<string | null | undefined>,
): Promise<Map<string, StorageBackend>> => {
  const uniqueIds = Array.from(
    new Set(ids.map((id) => id?.trim() ?? "").filter(Boolean)),
  );
  const result = new Map<string, StorageBackend>();
  for (const id of uniqueIds) {
    result.set(id, "supabase");
  }
  if (uniqueIds.length === 0) {
    return result;
  }

  const rows = await prisma.storage_objects.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, backend: true },
  });
  for (const row of rows) {
    if (row.backend === "s3") {
      result.set(row.id, "s3");
    }
  }
  return result;
};

export const getStorageBackendForId = async (id: string): Promise<StorageBackend> => {
  const map = await resolveStorageBackends([id]);
  return map.get(id) ?? "supabase";
};

export const registerStorageObject = async (input: {
  id: string;
  backend: StorageBackend;
  pathKind: StoragePathKind;
  ownerId: string;
}): Promise<void> => {
  const existing = await prisma.storage_objects.findUnique({
    where: { id: input.id },
    select: { owner_id: true, path_kind: true, backend: true },
  });
  if (existing) {
    // Never let a later caller steal or re-point another owner's registry row.
    if (existing.owner_id !== input.ownerId || existing.path_kind !== input.pathKind) {
      throw new Error("storage_object_conflict");
    }
    if (existing.backend === input.backend) {
      return;
    }
    await prisma.storage_objects.update({
      where: { id: input.id },
      data: { backend: input.backend },
    });
    return;
  }

  await prisma.storage_objects.create({
    data: {
      id: input.id,
      backend: input.backend,
      path_kind: input.pathKind,
      owner_id: input.ownerId,
    },
  });
};
