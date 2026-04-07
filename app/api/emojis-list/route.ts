import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { emojiUpdatedAtIso, emojiUpdatedAtMs } from "@/app/api/emoji_row_utils";
import { EmojisListRequest, EmojisListResponse } from "@/app/types/interfaces";

const rowToEmojiItem = (row: {
  uuid: string;
  created_at: Date;
  updated_at: Date | null;
  name: string | null;
  data: string;
}) => ({
  uuid: row.uuid,
  created_at: row.created_at.toISOString(),
  updated_at: emojiUpdatedAtIso(row),
  name: row.name?.trim() || "Untitled",
  data_b64: row.data ?? "",
});

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("emojis_list_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    let body: EmojisListRequest = {};
    try {
      body = (await request.json()) as EmojisListRequest;
    } catch {
      body = {};
    }

    const clientKnownRaw = Array.isArray(body.client_known) ? body.client_known : [];
    const clientKnown = clientKnownRaw
      .map((entry) => ({
        uuid: typeof entry?.uuid === "string" ? entry.uuid.trim() : "",
        updated_at: typeof entry?.updated_at === "string" ? entry.updated_at.trim() : "",
      }))
      .filter((entry) => entry.uuid.length > 0);

    const knownByUuid = new Map(clientKnown.map((c) => [c.uuid, c.updated_at]));

    const rows = await prisma.emojis.findMany({
      where: { created_by: authResult.user_id },
      orderBy: [{ created_at: "desc" }, { uuid: "desc" }],
      select: {
        uuid: true,
        created_at: true,
        updated_at: true,
        name: true,
        data: true,
      },
    });

    const serverUuids = new Set(rows.map((r) => r.uuid));
    const removed_uuids = clientKnown.map((c) => c.uuid).filter((uuid) => !serverUuids.has(uuid));

    const delta = rows.filter((row) => {
      const prev = knownByUuid.get(row.uuid);
      if (prev === undefined) {
        return true;
      }
      const prevMs = Date.parse(prev);
      if (Number.isNaN(prevMs)) {
        return true;
      }
      return emojiUpdatedAtMs(row) !== prevMs;
    });

    const payload: EmojisListResponse = {
      emojis: delta.map(rowToEmojiItem),
      ...(removed_uuids.length > 0 ? { removed_uuids } : {}),
    };

    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("emojis_list_failed", error);
    return NextResponse.json(
      { error: { code: "emojis_list_failed", message: "Failed to load emojis." } },
      { status: 500 },
    );
  }
}
