import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { getSignedMainBucketImageUrl } from "@/app/api/server_file_storage_utils";
import { loadDevAccountFamilyContext } from "@/app/lib/devAccounts";
import { prisma } from "@/app/lib/prisma";
import type { DevAccountListItem, DevAccountsListResponse } from "@/app/types/interfaces";

/** List the primary developer account and all linked child/dev accounts. */
export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    // Gate: family root must be on DEVELOPER_USER_IDS (works from primary or child session).
    const loaded = await loadDevAccountFamilyContext(authResult.user_id);
    if ("error" in loaded) {
      return NextResponse.json(
        { error: { code: loaded.error.code, message: loaded.error.message } },
        { status: loaded.error.status },
      );
    }

    const { familyRootId, currentUser } = loaded.context;

    // Primary row + any users pointing primary_user_id at it.
    const familyUsers = await prisma.users.findMany({
      where: {
        OR: [{ id: familyRootId }, { primary_user_id: familyRootId }],
      },
      select: {
        id: true,
        username: true,
        profile_image_id: true,
        primary_user_id: true,
      },
      orderBy: { created_at: "asc" },
    });

    const accounts: DevAccountListItem[] = await Promise.all(
      familyUsers.map(async (user) => {
        let profileImageUrl: string | null = null;
        if (user.profile_image_id) {
          try {
            profileImageUrl = await getSignedMainBucketImageUrl({
              userId: user.id,
              imageId: user.profile_image_id,
            });
          } catch (error) {
            console.error("dev_accounts_list_profile_image_sign_failed", user.id, error);
          }
        }

        return {
          user_id: user.id,
          username: user.username,
          profile_image_id: user.profile_image_id,
          profile_image_url: profileImageUrl,
          is_current: user.id === currentUser.id,
          is_primary: user.primary_user_id === null,
        };
      }),
    );

    // Primary first, then children (creation order preserved within each group).
    accounts.sort((a, b) => {
      if (a.is_primary === b.is_primary) {
        return 0;
      }
      return a.is_primary ? -1 : 1;
    });

    const payload: DevAccountsListResponse = { accounts };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("dev_accounts_list_failed", error);
    return NextResponse.json(
      { error: { code: "dev_accounts_list_failed", message: "Failed to list dev accounts." } },
      { status: 500 },
    );
  }
}
