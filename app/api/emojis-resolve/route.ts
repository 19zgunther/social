import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { emojiUpdatedAtIso } from "@/app/api/emoji_row_utils";
import { prisma } from "@/app/lib/prisma";
import { EmojisResolveResponse } from "@/app/types/interfaces";

type EmojisResolveRequest = {
  uuids?: string[];
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("emojis_resolve_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as EmojisResolveRequest;
    const uuids = Array.isArray(body.uuids)
      ? Array.from(new Set(body.uuids.map((value) => value.trim()).filter(Boolean))).slice(0, 500)
      : [];

    if (uuids.length === 0) {
      const emptyPayload: EmojisResolveResponse = { emojis_by_uuid: {} };
      return NextResponse.json(emptyPayload, { status: 200 });
    }

    const rows = await prisma.emojis.findMany({
      where: { uuid: { in: uuids } },
      select: {
        uuid: true,
        created_at: true,
        updated_at: true,
        name: true,
        data: true,
      },
    });

    const payload: EmojisResolveResponse = {
      emojis_by_uuid: Object.fromEntries(
        rows.map((row) => [
          row.uuid,
          {
            uuid: row.uuid,
            created_at: row.created_at.toISOString(),
            updated_at: emojiUpdatedAtIso(row),
            name: row.name?.trim() || "Untitled",
            data_b64: row.data ?? "",
          },
        ]),
      ),
    };

    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("emojis_resolve_failed", error);
    return NextResponse.json(
      { error: { code: "emojis_resolve_failed", message: "Failed to resolve emojis." } },
      { status: 500 },
    );
  }
}
