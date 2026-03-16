import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { getSignedMainBucketThreadImageUrl } from "@/app/api/server_file_storage_utils";
import { GroupsListResponse } from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("groups_list_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const threads = await prisma.threads.findMany({
      where: {
        OR: [
          { owner: authResult.user_id },
          { user_thread_access: { some: { user_id: authResult.user_id } } },
        ],
      },
      orderBy: { created_at: "desc" },
      select: {
        id: true,
        name: true,
        owner: true,
        image_id: true,
        created_at: true,
        users: {
          select: {
            username: true,
          },
        },
      },
    });

    const imageUrlEntries = await Promise.all(
      threads.map(async (thread) => {
        if (!thread.image_id) {
          return [thread.id, null] as const;
        }

        try {
          const signedUrl = await getSignedMainBucketThreadImageUrl({
            threadId: thread.id,
            imageId: thread.image_id,
          });
          return [thread.id, signedUrl] as const;
        } catch (error) {
          console.error("groups_list_thread_image_sign_failed", thread.id, error);
          return [thread.id, null] as const;
        }
      }),
    );
    const imageUrlByThreadId = new Map(imageUrlEntries);

    const payload: GroupsListResponse = {
      threads: threads.map((thread) => ({
        id: thread.id,
        name: thread.name,
        created_at: thread.created_at.toISOString(),
        owner_user_id: thread.owner,
        owner_username: thread.users.username,
        image_id: thread.image_id,
        image_url: imageUrlByThreadId.get(thread.id) ?? null,
      })),
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("groups_list_failed", error);
    return NextResponse.json(
      { error: { code: "groups_list_failed", message: "Failed to load groups." } },
      { status: 500 },
    );
  }
}
