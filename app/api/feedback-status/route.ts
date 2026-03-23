import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { getSignedMainBucketImageUrl } from "@/app/api/server_file_storage_utils";

type Body = {
  feedback_id?: string;
  status?: string;
};

const ALLOWED = new Set(["resolved", "unresolved"]);

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("feedback_status_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as Body;
    const feedbackId = body.feedback_id?.trim();
    const status = body.status?.trim();
    if (!feedbackId || !status || !ALLOWED.has(status)) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "feedback_id and status (resolved | unresolved) are required.",
          },
        },
        { status: 400 },
      );
    }

    const existing = await prisma.shared_feedback.findFirst({
      where: { id: feedbackId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Feedback not found." } },
        { status: 404 },
      );
    }

    const row = await prisma.shared_feedback.update({
      where: { id: feedbackId },
      data: { status },
      select: {
        id: true,
        created_at: true,
        created_by: true,
        text: true,
        status: true,
        image_id: true,
        users: { select: { username: true } },
      },
    });

    let imageUrl: string | null = null;
    if (row.image_id) {
      try {
        imageUrl = await getSignedMainBucketImageUrl({
          userId: row.created_by,
          imageId: row.image_id,
        });
      } catch (error) {
        console.error("feedback_status_image_sign_failed", row.id, error);
      }
    }

    return NextResponse.json(
      {
        item: {
          id: row.id,
          created_at: row.created_at.toISOString(),
          created_by: row.created_by,
          text: row.text,
          status: row.status as "resolved" | "unresolved",
          username: row.users.username,
          image_id: row.image_id,
          image_url: imageUrl,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("feedback_status_failed", error);
    return NextResponse.json(
      { error: { code: "feedback_status_failed", message: "Failed to update status." } },
      { status: 500 },
    );
  }
}
