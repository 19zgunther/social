import { NextResponse } from "next/server";
import { mintUserToken } from "@/app/api/auth_utils";
import type { Prisma } from "@/app/generated/prisma/client";
import { isDeveloperUserId } from "@/app/lib/developerUserIds";
import { emptyPostGroupsData } from "@/app/lib/postGroups";
import { prisma } from "@/app/lib/prisma";
import { getSignedMainBucketImageUrl } from "@/app/api/server_file_storage_utils";
import { parseThemeInfo } from "@/app/lib/theme";
import { parseUsersStatusMap } from "@/app/lib/threadEvents";
import {
  MAX_DEV_ACCOUNTS_PER_PRIMARY,
  USERNAME_RE,
  USERNAME_RULES_MESSAGE,
} from "@/app/lib/usernames";
import type { AuthUser, LoginResponse } from "@/app/types/interfaces";

export { isDeveloperUserId, MAX_DEV_ACCOUNTS_PER_PRIMARY };

/** Compose `{primaryUsername}_{devName}`; strips a pasted prefix if present. */
export function buildDevAccountUsername(
  primaryUsername: string,
  rawSuffix: string,
): string | { error: string } {
  const prefix = `${primaryUsername}_`;
  let suffix = rawSuffix.trim();
  if (suffix.startsWith(prefix)) {
    suffix = suffix.slice(prefix.length);
  }
  // Drop a leading underscore if the user typed one after the visible prefix.
  if (suffix.startsWith("_")) {
    suffix = suffix.slice(1);
  }

  if (!suffix) {
    return { error: "Enter a name after the username prefix." };
  }

  const username = `${primaryUsername}_${suffix}`;
  if (!USERNAME_RE.test(username)) {
    return { error: USERNAME_RULES_MESSAGE };
  }
  return username;
}

const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export type DevAccountFamilyUser = {
  id: string;
  username: string;
  email: string | null;
  profile_image_id: string | null;
  theme_info: Prisma.JsonValue | null;
  primary_user_id: string | null;
};

export type DevAccountAuthzError = {
  status: number;
  code: string;
  message: string;
};

export type DevAccountFamilyContext = {
  currentUser: DevAccountFamilyUser;
  familyRootId: string;
  isRoot: boolean;
};

/** Primary is itself; a child resolves to its primary_user_id. */
export function resolveFamilyRootId(user: {
  id: string;
  primary_user_id: string | null;
}): string {
  return user.primary_user_id ?? user.id;
}

/** True when this user (or their primary) is on DEVELOPER_USER_IDS. */
export function canUseDevAccountSwitcher(user: {
  id: string;
  primary_user_id: string | null;
}): boolean {
  return isDeveloperUserId(resolveFamilyRootId(user));
}

/** Load current user and ensure their family root is on DEVELOPER_USER_IDS. */
export async function loadDevAccountFamilyContext(
  userId: string,
): Promise<{ context: DevAccountFamilyContext } | { error: DevAccountAuthzError }> {
  const currentUser = await prisma.users.findFirst({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      email: true,
      profile_image_id: true,
      theme_info: true,
      primary_user_id: true,
    },
  });

  if (!currentUser) {
    return {
      error: {
        status: 401,
        code: "user_not_found",
        message: "User not found.",
      },
    };
  }

  const familyRootId = resolveFamilyRootId(currentUser);
  // Children inherit access when their primary is a listed developer.
  if (!isDeveloperUserId(familyRootId)) {
    return {
      error: {
        status: 403,
        code: "forbidden",
        message: "Dev account switcher is only available to developers.",
      },
    };
  }

  return {
    context: {
      currentUser,
      familyRootId,
      isRoot: currentUser.primary_user_id === null,
    },
  };
}

/** Target must be the family primary or a direct child of that primary. */
export function assertTargetInFamily(input: {
  familyRootId: string;
  target: { id: string; primary_user_id: string | null };
}): DevAccountAuthzError | null {
  const { familyRootId, target } = input;
  const isPrimary = target.id === familyRootId && target.primary_user_id === null;
  const isChild = target.primary_user_id === familyRootId;
  if (!isPrimary && !isChild) {
    return {
      status: 403,
      code: "forbidden",
      message: "Target account is not in this developer family.",
    };
  }
  return null;
}

async function buildAuthUser(user: {
  id: string;
  username: string;
  email: string | null;
  profile_image_id: string | null;
  theme_info: Prisma.JsonValue | null;
  primary_user_id: string | null;
}): Promise<AuthUser> {
  let profileImageUrl: string | null = null;
  if (user.profile_image_id) {
    try {
      profileImageUrl = await getSignedMainBucketImageUrl({
        userId: user.id,
        imageId: user.profile_image_id,
      });
    } catch (error) {
      console.error("dev_account_profile_image_sign_failed", user.id, error);
    }
  }

  return {
    user_id: user.id,
    username: user.username,
    email: user.email,
    profile_image_id: user.profile_image_id,
    profile_image_url: profileImageUrl,
    minted_at: Date.now(),
    theme_info: parseThemeInfo(user.theme_info),
    primary_user_id: user.primary_user_id,
    can_use_dev_account_switcher: canUseDevAccountSwitcher(user),
  };
}

/** Mint a fresh auth token and set the httpOnly auth_token cookie (same as login). */
export async function jsonAuthSuccessForUser(user: {
  id: string;
  username: string;
  email: string | null;
  profile_image_id: string | null;
  theme_info: Prisma.JsonValue | null;
  primary_user_id: string | null;
}): Promise<NextResponse> {
  const token = mintUserToken({
    user_id: user.id,
    username: user.username,
    user_email: user.email,
  });

  const authUser = await buildAuthUser(user);
  const payload: LoginResponse = {
    token,
    user: authUser,
  };
  const response = NextResponse.json(payload, { status: 200 });
  response.cookies.set("auth_token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AUTH_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}

/**
 * Soft reset: drop friends, leave thread memberships, clear RSVPs/cohost roles.
 * Does not delete threads, messages, hosted events, posts, or the user row.
 */
export async function resetDevAccountSocialGraph(userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // 1. Friends (pending / accepted / rejected).
    await tx.friends.deleteMany({
      where: {
        OR: [{ requesting_user: userId }, { other_user: userId }],
      },
    });

    // 2. Clear this user's post-visibility groups.
    await tx.users.update({
      where: { id: userId },
      data: {
        post_groups_data: emptyPostGroupsData() as unknown as Prisma.InputJsonValue,
      },
    });

    // 3. Drop cohost (and any other) event roles for this user.
    await tx.user_thread_event_role.deleteMany({
      where: { user_id: userId },
    });

    // Threads this user can see (owned or access) — used to find RSVPs to strip.
    const ownedThreads = await tx.threads.findMany({
      where: { owner: userId },
      select: { id: true },
    });
    const accessRows = await tx.user_thread_access.findMany({
      where: { user_id: userId },
      select: { thread_id: true },
    });
    const memberThreadIds = [
      ...new Set([
        ...ownedThreads.map((thread) => thread.id),
        ...accessRows.map((row) => row.thread_id),
      ]),
    ];

    // 4. Soft: strip RSVP only — do not delete events (even ones this user hosts).
    const eventsToClean =
      memberThreadIds.length > 0
        ? await tx.thread_events.findMany({
            where: {
              OR: [{ thread_id: { in: memberThreadIds } }, { created_by: userId }],
            },
            select: {
              id: true,
              users_status_map: true,
            },
          })
        : await tx.thread_events.findMany({
            where: { created_by: userId },
            select: {
              id: true,
              users_status_map: true,
            },
          });

    const eventsById = new Map<string, { id: string; users_status_map: Prisma.JsonValue }>();
    for (const event of eventsToClean) {
      eventsById.set(event.id, event);
    }

    for (const event of eventsById.values()) {
      const statusMap = parseUsersStatusMap(event.users_status_map);
      if (!(userId in statusMap)) {
        continue;
      }
      delete statusMap[userId];
      await tx.thread_events.update({
        where: { id: event.id },
        data: {
          users_status_map: statusMap as unknown as Prisma.InputJsonValue,
        },
      });
    }

    // 5. Leave every thread via access/read rows. Owned threads stay (owner FK); soft leave only.
    await tx.user_thread_access.deleteMany({
      where: { user_id: userId },
    });
    await tx.user_thread_last_read_at.deleteMany({
      where: { user_id: userId },
    });
  });
}
