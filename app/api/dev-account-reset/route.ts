import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import {
  assertTargetInFamily,
  loadDevAccountFamilyContext,
  resetDevAccountSocialGraph,
} from "@/app/lib/devAccounts";
import { prisma } from "@/app/lib/prisma";
import type { DevAccountResetRequest, DevAccountResetResponse } from "@/app/types/interfaces";

/** Soft-reset a child/dev account: unfriend + leave memberships/RSVPs (does not delete owned threads). */
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

    const body = (await request.json().catch(() => ({}))) as DevAccountResetRequest;
    // Default to resetting the currently authenticated account.
    const targetUserId = body.target_user_id?.trim() || authResult.user_id;

    const target = await prisma.users.findFirst({
      where: { id: targetUserId },
      select: {
        id: true,
        primary_user_id: true,
      },
    });

    if (!target) {
      return NextResponse.json(
        { error: { code: "user_not_found", message: "Target account not found." } },
        { status: 404 },
      );
    }

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

    // Never reset the primary developer account itself.
    if (!target.primary_user_id) {
      return NextResponse.json(
        {
          error: {
            code: "forbidden",
            message: "Only child/dev accounts can be reset.",
          },
        },
        { status: 403 },
      );
    }

    await resetDevAccountSocialGraph(target.id);

    const payload: DevAccountResetResponse = { ok: true };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("dev_account_reset_failed", error);
    return NextResponse.json(
      { error: { code: "dev_account_reset_failed", message: "Failed to reset dev account." } },
      { status: 500 },
    );
  }
}
