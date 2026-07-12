import { prisma } from "@/app/lib/prisma";
import { loadAcceptedFriendIds } from "@/app/lib/acceptedFriendIds";
import {
  emptyPostGroupsData,
  isUuid,
  parsePostGroupsData,
} from "@/app/lib/postGroups";

export type PostAudienceMode = "permanent" | "all" | "group";

export type PostAudienceInput = {
  mode?: string;
  group_id?: string;
};

export type ResolvedPostAudience =
  | { mode: "permanent"; viewerIds: string[] }
  | { mode: "all"; viewerIds: string[] }
  | { mode: "group"; groupId: string; viewerIds: string[] };

export type ResolveAudienceError = {
  code: string;
  message: string;
};

/** Posts visible to a viewer: own posts, permanent friend posts, or explicit access rows. */
export const visiblePostsWhereForViewer = (viewerUserId: string, friendUserIds: string[]) => ({
  OR: [
    { created_by: viewerUserId },
    {
      AND: [
        { created_by: { in: friendUserIds } },
        {
          OR: [
            { permanent: true },
            { user_post_access: { some: { viewer_id: viewerUserId } } },
          ],
        },
      ],
    },
  ],
});

/** Posts by `authorUserId` that `viewerUserId` may see (friends assumed). */
export const visibleAuthorPostsWhereForViewer = (
  authorUserId: string,
  viewerUserId: string,
) => ({
  created_by: authorUserId,
  OR: [
    { permanent: true },
    { user_post_access: { some: { viewer_id: viewerUserId } } },
  ],
});

export async function resolvePostAudience(input: {
  authorUserId: string;
  audience: PostAudienceInput | undefined;
}): Promise<{ audience: ResolvedPostAudience } | { error: ResolveAudienceError }> {
  const rawMode = input.audience?.mode?.trim().toLowerCase() || "permanent";
  if (rawMode !== "permanent" && rawMode !== "all" && rawMode !== "group") {
    return {
      error: {
        code: "invalid_audience",
        message: "audience.mode must be permanent, all, or group.",
      },
    };
  }

  const friendIds = await loadAcceptedFriendIds(input.authorUserId);
  const friendIdList = Array.from(friendIds);

  if (rawMode === "permanent") {
    return { audience: { mode: "permanent", viewerIds: friendIdList } };
  }

  if (rawMode === "all") {
    return { audience: { mode: "all", viewerIds: friendIdList } };
  }

  const groupId = input.audience?.group_id?.trim() ?? "";
  if (!isUuid(groupId)) {
    return {
      error: {
        code: "invalid_group_id",
        message: "audience.group_id must be a valid group id.",
      },
    };
  }

  const user = await prisma.users.findFirst({
    where: { id: input.authorUserId },
    select: { post_groups_data: true },
  });
  const groupsData = parsePostGroupsData(user?.post_groups_data ?? emptyPostGroupsData());
  const group = groupsData.groups.find((entry) => entry.id === groupId);
  if (!group) {
    return {
      error: {
        code: "group_not_found",
        message: "That post group was not found.",
      },
    };
  }

  const viewerIds = group.member_ids.filter((memberId) => friendIds.has(memberId));
  return { audience: { mode: "group", groupId, viewerIds } };
}

export async function canViewerAccessPost(input: {
  viewerUserId: string;
  post: { id: string; created_by: string; permanent: boolean | null };
}): Promise<boolean> {
  if (input.post.created_by === input.viewerUserId) {
    return true;
  }

  const friendIds = await loadAcceptedFriendIds(input.viewerUserId);
  if (!friendIds.has(input.post.created_by)) {
    return false;
  }

  if (input.post.permanent === true) {
    return true;
  }

  const access = await prisma.user_post_access.findFirst({
    where: {
      post_id: input.post.id,
      viewer_id: input.viewerUserId,
    },
    select: { id: true },
  });
  return Boolean(access);
}
