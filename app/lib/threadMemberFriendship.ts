import { prisma } from "@/app/lib/prisma";
import type { ThreadMemberFriendshipStatus } from "@/app/types/interfaces";

const statusFromRow = (
  row: { requesting_user: string; accepted: boolean | null },
  viewerUserId: string,
): Exclude<ThreadMemberFriendshipStatus, "self" | "none"> => {
  if (row.accepted === true) {
    return "friends";
  }
  if (row.accepted === false) {
    return "rejected";
  }
  if (row.requesting_user === viewerUserId) {
    return "pending_sent";
  }
  return "pending_received";
};

/** Friendship between viewer and each member id (use `"self"` when ids match). */
export async function threadMemberFriendshipStatusesForMany(
  viewerUserId: string,
  memberUserIds: string[],
): Promise<Map<string, ThreadMemberFriendshipStatus>> {
  const map = new Map<string, ThreadMemberFriendshipStatus>();
  for (const id of memberUserIds) {
    map.set(id, id === viewerUserId ? "self" : "none");
  }

  const others = memberUserIds.filter((id) => id !== viewerUserId);
  if (others.length === 0) {
    return map;
  }

  const rows = await prisma.friends.findMany({
    where: {
      OR: [
        { requesting_user: viewerUserId, other_user: { in: others } },
        { other_user: viewerUserId, requesting_user: { in: others } },
      ],
    },
    select: {
      requesting_user: true,
      other_user: true,
      accepted: true,
    },
  });

  for (const row of rows) {
    const otherId =
      row.requesting_user === viewerUserId ? row.other_user : row.requesting_user;
    if (!others.includes(otherId)) {
      continue;
    }
    map.set(otherId, statusFromRow(row, viewerUserId));
  }

  return map;
}

export async function threadMemberFriendshipStatusForPair(
  viewerUserId: string,
  memberUserId: string,
): Promise<ThreadMemberFriendshipStatus> {
  if (viewerUserId === memberUserId) {
    return "self";
  }
  const row = await prisma.friends.findFirst({
    where: {
      OR: [
        { requesting_user: viewerUserId, other_user: memberUserId },
        { other_user: viewerUserId, requesting_user: memberUserId },
      ],
    },
    select: {
      requesting_user: true,
      accepted: true,
    },
  });
  if (!row) {
    return "none";
  }
  return statusFromRow(row, viewerUserId);
}
