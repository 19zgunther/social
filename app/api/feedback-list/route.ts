import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("feedback_list_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const rows = await prisma.shared_feedback.findMany({
      orderBy: { created_at: "desc" },
      select: {
        id: true,
        created_at: true,
        created_by: true,
        text: true,
        status: true,
        users: {
          select: { username: true },
        },
      },
    });

    const items = rows.map((row) => ({
      id: row.id,
      created_at: row.created_at.toISOString(),
      created_by: row.created_by,
      text: row.text,
      status: row.status === "resolved" ? "resolved" : "unresolved",
      username: row.users.username,
    }));

    return NextResponse.json({ items }, { status: 200 });
  } catch (error) {
    console.error("feedback_list_failed", error);
    return NextResponse.json(
      { error: { code: "feedback_list_failed", message: "Failed to load feedback." } },
      { status: 500 },
    );
  }
}
