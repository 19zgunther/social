import type { PostGroup, PostGroupsData } from "@/app/types/interfaces";

export const POST_GROUPS_MAX_GROUPS = 20;
export const POST_GROUPS_MAX_MEMBERSHIPS = 500;
export const POST_GROUPS_NAME_MAX_LENGTH = 40;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isUuid = (value: string): boolean => UUID_RE.test(value);

export const emptyPostGroupsData = (): PostGroupsData => ({ groups: [] });

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

/** Parse stored JSON into a normalized document; unknown shapes become empty. */
export const parsePostGroupsData = (raw: unknown): PostGroupsData => {
  const root = asRecord(raw);
  if (!root || !Array.isArray(root.groups)) {
    return emptyPostGroupsData();
  }

  const groups: PostGroup[] = [];
  for (const entry of root.groups) {
    const row = asRecord(entry);
    if (!row) {
      continue;
    }
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!isUuid(id) || !name) {
      continue;
    }
    const memberIdsRaw = Array.isArray(row.member_ids) ? row.member_ids : [];
    const member_ids: string[] = [];
    const seen = new Set<string>();
    for (const memberId of memberIdsRaw) {
      if (typeof memberId !== "string") {
        continue;
      }
      const cleaned = memberId.trim();
      if (!isUuid(cleaned) || seen.has(cleaned)) {
        continue;
      }
      seen.add(cleaned);
      member_ids.push(cleaned);
    }
    groups.push({
      id,
      name: name.slice(0, POST_GROUPS_NAME_MAX_LENGTH),
      member_ids,
    });
  }

  return { groups };
};

/** Drop member IDs that are not in the accepted-friends set. */
export const stripNonFriendMembers = (
  data: PostGroupsData,
  acceptedFriendIds: ReadonlySet<string>,
): { data: PostGroupsData; changed: boolean } => {
  let changed = false;
  const groups = data.groups.map((group) => {
    const nextMembers = group.member_ids.filter((id) => acceptedFriendIds.has(id));
    if (nextMembers.length !== group.member_ids.length) {
      changed = true;
    }
    return { ...group, member_ids: nextMembers };
  });
  return { data: { groups }, changed };
};

export type PostGroupsValidationError = {
  code: string;
  message: string;
};

/** Validate a client-submitted document. Returns cleaned data or an error. */
export const validatePostGroupsForSave = (
  raw: unknown,
  acceptedFriendIds: ReadonlySet<string>,
): { data: PostGroupsData } | { error: PostGroupsValidationError } => {
  const root = asRecord(raw);
  if (!root || !Array.isArray(root.groups)) {
    return {
      error: {
        code: "invalid_groups",
        message: "Groups payload must include a groups array.",
      },
    };
  }

  if (root.groups.length > POST_GROUPS_MAX_GROUPS) {
    return {
      error: {
        code: "too_many_groups",
        message: `You can have at most ${POST_GROUPS_MAX_GROUPS} groups.`,
      },
    };
  }

  const groups: PostGroup[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  let membershipCount = 0;

  for (const entry of root.groups) {
    const row = asRecord(entry);
    if (!row) {
      return {
        error: { code: "invalid_group", message: "Each group must be an object." },
      };
    }

    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!isUuid(id)) {
      return {
        error: { code: "invalid_group_id", message: "Each group needs a valid id." },
      };
    }
    if (seenIds.has(id)) {
      return {
        error: { code: "duplicate_group_id", message: "Group ids must be unique." },
      };
    }
    seenIds.add(id);

    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!name || name.length > POST_GROUPS_NAME_MAX_LENGTH) {
      return {
        error: {
          code: "invalid_group_name",
          message: `Group names must be 1–${POST_GROUPS_NAME_MAX_LENGTH} characters.`,
        },
      };
    }
    const nameKey = name.toLowerCase();
    if (seenNames.has(nameKey)) {
      return {
        error: {
          code: "duplicate_group_name",
          message: "Group names must be unique.",
        },
      };
    }
    seenNames.add(nameKey);

    if (!Array.isArray(row.member_ids)) {
      return {
        error: {
          code: "invalid_member_ids",
          message: "Each group needs a member_ids array.",
        },
      };
    }

    const member_ids: string[] = [];
    const memberSeen = new Set<string>();
    for (const memberId of row.member_ids) {
      if (typeof memberId !== "string") {
        return {
          error: {
            code: "invalid_member_id",
            message: "Member ids must be strings.",
          },
        };
      }
      const cleaned = memberId.trim();
      if (!isUuid(cleaned)) {
        return {
          error: {
            code: "invalid_member_id",
            message: "Each member id must be a valid user id.",
          },
        };
      }
      if (!acceptedFriendIds.has(cleaned)) {
        return {
          error: {
            code: "non_friend_member",
            message: "Only accepted friends can be added to groups.",
          },
        };
      }
      if (memberSeen.has(cleaned)) {
        continue;
      }
      memberSeen.add(cleaned);
      member_ids.push(cleaned);
    }

    membershipCount += member_ids.length;
    if (membershipCount > POST_GROUPS_MAX_MEMBERSHIPS) {
      return {
        error: {
          code: "too_many_memberships",
          message: `Total group memberships cannot exceed ${POST_GROUPS_MAX_MEMBERSHIPS}.`,
        },
      };
    }

    groups.push({ id, name, member_ids });
  }

  return { data: { groups } };
};
