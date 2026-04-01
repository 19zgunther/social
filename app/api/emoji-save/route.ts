import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { EmojiSaveRequest, EmojiSaveResponse } from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("emoji_save_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as EmojiSaveRequest;
    const emojiUuid = body.emoji_uuid?.trim();
    const name = body.name?.trim() ?? "";
    const dataB64 = body.data_b64?.trim() ?? "";

    if (!dataB64) {
      return NextResponse.json(
        { error: { code: "missing_data_b64", message: "Emoji data is required." } },
        { status: 400 },
      );
    }

    if (dataB64.length !== 8192) {
      return NextResponse.json(
        { error: { code: "invalid_data_b64", message: "Emoji data must be exactly 8192 characters." } },
        { status: 400 },
      );
    }

    const cleanName = name || "Untitled";

    if (emojiUuid) {
      const existing = await prisma.emojis.findUnique({
        where: { uuid: emojiUuid },
        select: { uuid: true, created_by: true, created_at: true },
      });
      if (!existing || existing.created_by !== authResult.user_id) {
        return NextResponse.json(
          { error: { code: "emoji_not_found", message: "Emoji not found." } },
          { status: 404 },
        );
      }

      const updated = await prisma.emojis.update({
        where: { uuid: emojiUuid },
        data: {
          name: cleanName,
          data: dataB64,
        },
        select: { uuid: true, created_at: true, name: true, data: true },
      });
      const payload: EmojiSaveResponse = {
        emoji: {
          uuid: updated.uuid,
          created_at: updated.created_at.toISOString(),
          name: updated.name?.trim() || "Untitled",
          data_b64: updated.data ?? "",
        },
      };
      return NextResponse.json(payload, { status: 200 });
    }

    const created = await prisma.emojis.create({
      data: {
        created_by: authResult.user_id,
        name: cleanName,
        data: dataB64,
      },
      select: {
        uuid: true,
        created_at: true,
        name: true,
        data: true,
      },
    });

    const payload: EmojiSaveResponse = {
      emoji: {
        uuid: created.uuid,
        created_at: created.created_at.toISOString(),
        name: created.name?.trim() || "Untitled",
        data_b64: created.data ?? "",
      },
    };

    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("emoji_save_failed", error);
    return NextResponse.json(
      { error: { code: "emoji_save_failed", message: "Failed to save emoji." } },
      { status: 500 },
    );
  }
}
