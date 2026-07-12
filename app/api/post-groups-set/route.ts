import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { loadAcceptedFriendIds } from "@/app/lib/acceptedFriendIds";
import { validatePostGroupsForSave } from "@/app/lib/postGroups";
import { PostGroupsSetRequest, PostGroupsSetResponse } from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("post_groups_set_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as PostGroupsSetRequest;
    const acceptedFriendIds = await loadAcceptedFriendIds(authResult.user_id);
    const validated = validatePostGroupsForSave(body, acceptedFriendIds);

    if ("error" in validated) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    await prisma.users.update({
      where: { id: authResult.user_id },
      data: {
        post_groups_data: validated.data as unknown as Prisma.InputJsonValue,
      },
    });

    const payload: PostGroupsSetResponse = validated.data;
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("post_groups_set_failed", error);
    return NextResponse.json(
      { error: { code: "post_groups_set_failed", message: "Failed to save post groups." } },
      { status: 500 },
    );
  }
}
