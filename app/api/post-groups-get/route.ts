import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { loadAcceptedFriendIds } from "@/app/lib/acceptedFriendIds";
import {
  emptyPostGroupsData,
  parsePostGroupsData,
  stripNonFriendMembers,
} from "@/app/lib/postGroups";
import { PostGroupsGetResponse } from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("post_groups_get_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const user = await prisma.users.findUnique({
      where: { id: authResult.user_id },
      select: { post_groups_data: true },
    });

    if (!user) {
      return NextResponse.json(
        { error: { code: "user_not_found", message: "User not found." } },
        { status: 404 },
      );
    }

    const acceptedFriendIds = await loadAcceptedFriendIds(authResult.user_id);
    const parsed = parsePostGroupsData(user.post_groups_data ?? emptyPostGroupsData());
    const { data, changed } = stripNonFriendMembers(parsed, acceptedFriendIds);

    if (changed) {
      await prisma.users.update({
        where: { id: authResult.user_id },
        data: {
          post_groups_data: data as unknown as Prisma.InputJsonValue,
        },
      });
    }

    const payload: PostGroupsGetResponse = data;
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("post_groups_get_failed", error);
    return NextResponse.json(
      { error: { code: "post_groups_get_failed", message: "Failed to load post groups." } },
      { status: 500 },
    );
  }
}
