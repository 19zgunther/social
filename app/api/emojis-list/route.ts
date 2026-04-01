import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { EmojisListResponse } from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("emojis_list_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const rows = await prisma.emojis.findMany({
      where: { created_by: authResult.user_id },
      orderBy: [{ created_at: "desc" }, { uuid: "desc" }],
      select: {
        uuid: true,
        created_at: true,
        name: true,
        data: true,
      },
    });

    const payload: EmojisListResponse = {
      emojis: rows.map((row) => ({
        uuid: row.uuid,
        created_at: row.created_at.toISOString(),
        name: row.name?.trim() || "Untitled",
        data_b64: row.data ?? "",
      })),
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
