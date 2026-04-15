import type { PrismaClient } from "@/app/generated/prisma/client";

/** Member ids for a thread: owner plus everyone in `user_thread_access`. */
export function threadMemberIds(thread: {
  owner: string;
  user_thread_access: { user_id: string }[];
}): Set<string> {
  return new Set([thread.owner, ...thread.user_thread_access.map((a) => a.user_id)]);
}

/** The other participant in a 1:1 direct thread (relative to `viewerUserId`). */
export function directPeerUserId(
  thread: { owner: string; user_thread_access: { user_id: string }[] },
  viewerUserId: string,
): string | null {
  const ids = threadMemberIds(thread);
  if (ids.size !== 2 || !ids.has(viewerUserId)) {
    return null;
  }
  return [...ids].find((id) => id !== viewerUserId) ?? null;
}

export async function findDirectThreadBetweenUsers(
  prisma: PrismaClient,
  userA: string,
  userB: string,
): Promise<{
  id: string;
  owner: string;
  name: string;
  created_at: Date;
  image_id: string | null;
  is_direct: boolean | null;
  users: { username: string };
  user_thread_access: { user_id: string }[];
} | null> {
  const candidates = await prisma.threads.findMany({
    where: {
      is_direct: true,
      created_by_event: null,
      OR: [
        { owner: userA, user_thread_access: { some: { user_id: userB } } },
        { owner: userB, user_thread_access: { some: { user_id: userA } } },
      ],
    },
    select: {
      id: true,
      owner: true,
      name: true,
      created_at: true,
      image_id: true,
      is_direct: true,
      users: { select: { username: true } },
      user_thread_access: { select: { user_id: true } },
    },
  });

  for (const thread of candidates) {
    const members = threadMemberIds(thread);
    if (members.size === 2 && members.has(userA) && members.has(userB)) {
      return thread;
    }
  }
  return null;
}

/** Username to show for a direct thread to `viewerUserId` (the other participant). */
export async function directPeerUsernameForViewer(
  prisma: PrismaClient,
  thread: {
    owner: string;
    users: { username: string };
    user_thread_access: { user_id: string }[];
  },
  viewerUserId: string,
): Promise<string | null> {
  const peerId = directPeerUserId(thread, viewerUserId);
  if (!peerId) {
    return null;
  }
  if (peerId === thread.owner) {
    return thread.users.username;
  }
  const row = await prisma.users.findUnique({
    where: { id: peerId },
    select: { username: true },
  });
  return row?.username ?? null;
}
