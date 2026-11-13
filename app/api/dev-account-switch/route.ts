import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import {
  assertTargetInFamily,
  jsonAuthSuccessForUser,
  loadDevAccountFamilyContext,
} from "@/app/lib/devAccounts";
import { prisma } from "@/app/lib/prisma";
import type { DevAccountSwitchRequest } from "@/app/types/interfaces";

/** Switch into another account in the same developer family (new auth_token cookie). */
export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const loaded = await loadDevAccountFamilyContext(authResult.user_id);
    if ("error" in loaded) {
      return NextResponse.json(
        { error: { code: loaded.error.code, message: loaded.error.message } },
        { status: loaded.error.status },
      );
    }

    const body = (await request.json()) as DevAccountSwitchRequest;
    const targetUserId = body.target_user_id?.trim() ?? "";
    if (!targetUserId) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "target_user_id is required." } },
        { status: 400 },
      );
    }

    const target = await prisma.users.findFirst({
      where: { id: targetUserId },
      select: {
        id: true,
        username: true,
        email: true,
        profile_image_id: true,
        theme_info: true,
        primary_user_id: true,
      },
    });

    if (!target) {
      return NextResponse.json(
        { error: { code: "user_not_found", message: "Target account not found." } },
        { status: 404 },
      );
    }

    // Target must be the family primary or one of its children.
    const familyError = assertTargetInFamily({
      familyRootId: loaded.context.familyRootId,
      target,
    });
    if (familyError) {
      return NextResponse.json(
        { error: { code: familyError.code, message: familyError.message } },
        { status: familyError.status },
      );
    }

    // Overwrite auth_token so subsequent requests run as the target user.
    return jsonAuthSuccessForUser(target);
  } catch (error) {
    console.error("dev_account_switch_failed", error);
    return NextResponse.json(
      { error: { code: "dev_account_switch_failed", message: "Failed to switch account." } },
      { status: 500 },
    );
  }
}
