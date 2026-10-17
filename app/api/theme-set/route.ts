import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { parseThemeInfo, type ThemeInfo } from "@/app/lib/theme";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("theme_set_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ThemeInfo;
    const theme = parseThemeInfo(body);
    if (!theme) {
      return NextResponse.json(
        { error: { code: "invalid_theme", message: "Invalid theme_info payload." } },
        { status: 400 },
      );
    }

    await prisma.users.update({
      where: { id: authResult.user_id },
      data: {
        theme_info: theme as unknown as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json(theme, { status: 200 });
  } catch (error) {
    console.error("theme_set_failed", error);
    return NextResponse.json(
      { error: { code: "theme_set_failed", message: "Failed to save theme." } },
      { status: 500 },
    );
  }
}
