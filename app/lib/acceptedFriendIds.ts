import { prisma } from "@/app/lib/prisma";

export async function loadAcceptedFriendIds(userId: string): Promise<Set<string>> {
  const rows = await prisma.friends.findMany({
    where: {
      accepted: true,
      OR: [{ requesting_user: userId }, { other_user: userId }],
    },
    select: {
      requesting_user: true,
      other_user: true,
    },
  });

  const ids = new Set<string>();
  for (const row of rows) {
    ids.add(row.requesting_user === userId ? row.other_user : row.requesting_user);
  }
  return ids;
}
