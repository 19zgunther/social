import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";

type Body = {
  text?: string;
};

const MAX_LEN = 8000;

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("feedback_create_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as Body;
    const text = body.text?.trim();
    if (!text) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "text is required." } },
        { status: 400 },
      );
    }
    if (text.length > MAX_LEN) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: `text must be at most ${MAX_LEN} characters.` } },
        { status: 400 },
      );
    }

    const row = await prisma.shared_feedback.create({
      data: {
        created_by: authResult.user_id,
        text,
        status: "unresolved",
      },
      select: {
        id: true,
        created_at: true,
        created_by: true,
        text: true,
        status: true,
        users: { select: { username: true } },
      },
    });

    return NextResponse.json(
      {
        item: {
          id: row.id,
          created_at: row.created_at.toISOString(),
          created_by: row.created_by,
          text: row.text,
          status: row.status as "resolved" | "unresolved",
          username: row.users.username,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("feedback_create_failed", error);
    return NextResponse.json(
      { error: { code: "feedback_create_failed", message: "Failed to create feedback." } },
      { status: 500 },
    );
  }
}
