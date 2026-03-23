import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { getSignedMainBucketImageUrl } from "@/app/api/server_file_storage_utils";

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
        image_id: true,
        users: {
          select: { username: true },
        },
      },
    });

    const items = await Promise.all(
      rows.map(async (row) => {
        let imageUrl: string | null = null;
        if (row.image_id) {
          try {
            imageUrl = await getSignedMainBucketImageUrl({
              userId: row.created_by,
              imageId: row.image_id,
            });
          } catch (error) {
            console.error("feedback_list_image_sign_failed", row.id, error);
          }
        }
        return {
          id: row.id,
          created_at: row.created_at.toISOString(),
          created_by: row.created_by,
          text: row.text,
          status: row.status === "resolved" ? "resolved" : "unresolved",
          username: row.users.username,
          image_id: row.image_id,
          image_url: imageUrl,
        };
      }),
    );

    return NextResponse.json({ items }, { status: 200 });
  } catch (error) {
    console.error("feedback_list_failed", error);
    return NextResponse.json(
      { error: { code: "feedback_list_failed", message: "Failed to load feedback." } },
      { status: 500 },
    );
  }
}
