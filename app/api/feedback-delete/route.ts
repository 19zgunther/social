import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";

type Body = {
  feedback_id?: string;
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("feedback_delete_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as Body;
    const feedbackId = body.feedback_id?.trim();
    if (!feedbackId) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "feedback_id is required." } },
        { status: 400 },
      );
    }

    const row = await prisma.shared_feedback.findFirst({
      where: { id: feedbackId },
      select: { id: true, created_by: true },
    });
    if (!row) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Feedback not found." } },
        { status: 404 },
      );
    }

    if (row.created_by !== authResult.user_id) {
      return NextResponse.json(
        { error: { code: "not_allowed", message: "You can only delete feedback you created." } },
        { status: 403 },
      );
    }

    await prisma.shared_feedback.delete({ where: { id: row.id } });

    return NextResponse.json({ ok: true, feedback_id: row.id }, { status: 200 });
  } catch (error) {
    console.error("feedback_delete_failed", error);
    return NextResponse.json(
      { error: { code: "feedback_delete_failed", message: "Failed to delete feedback." } },
      { status: 500 },
    );
  }
}
