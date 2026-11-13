import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import {
  MAX_DEV_ACCOUNTS_PER_PRIMARY,
  buildDevAccountUsername,
  jsonAuthSuccessForUser,
  loadDevAccountFamilyContext,
} from "@/app/lib/devAccounts";
import { prisma } from "@/app/lib/prisma";
import type { DevAccountCreateRequest } from "@/app/types/interfaces";

/** Create a child/dev account under the primary developer, then auto-switch into it. */
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

    // No dev-of-dev: only the primary (root) can create children.
    const { context } = loaded;
    if (!context.isRoot) {
      return NextResponse.json(
        {
          error: {
            code: "forbidden",
            message: "Only the primary developer account can create child accounts.",
          },
        },
        { status: 403 },
      );
    }

    // Cap linked children per primary developer.
    const childCount = await prisma.users.count({
      where: { primary_user_id: context.familyRootId },
    });
    if (childCount >= MAX_DEV_ACCOUNTS_PER_PRIMARY) {
      return NextResponse.json(
        {
          error: {
            code: "dev_account_limit",
            message: `You can have at most ${MAX_DEV_ACCOUNTS_PER_PRIMARY} dev accounts.`,
          },
        },
        { status: 400 },
      );
    }

    const body = (await request.json()) as DevAccountCreateRequest;
    // Client sends only the suffix; we always compose `{primary}_{suffix}`.
    const built = buildDevAccountUsername(
      context.currentUser.username,
      body.username?.trim() ?? "",
    );
    if (typeof built !== "string") {
      return NextResponse.json(
        { error: { code: "invalid_username", message: built.error } },
        { status: 400 },
      );
    }
    const username = built;

    const existingUser = await prisma.users.findFirst({
      where: { username },
      select: { id: true },
    });
    if (existingUser) {
      return NextResponse.json(
        { error: { code: "user_exists", message: "Username already exists." } },
        { status: 409 },
      );
    }

    // No password — entry is via switcher only (login also blocks primary_user_id children).
    const createdUser = await prisma.users.create({
      data: {
        username,
        email: null,
        password_hash: null,
        primary_user_id: context.familyRootId,
        created_at: new Date(),
      },
      select: {
        id: true,
        username: true,
        email: true,
        profile_image_id: true,
        theme_info: true,
        primary_user_id: true,
      },
    });

    // Mint cookie for the new account so the client reloads as that user.
    return jsonAuthSuccessForUser(createdUser);
  } catch (error) {
    console.error("dev_account_create_failed", error);
    return NextResponse.json(
      { error: { code: "dev_account_create_failed", message: "Failed to create dev account." } },
      { status: 500 },
    );
  }
}
