import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";

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
        created_at: true,
        users: {
          select: {
            username: true,
          },
        },
      },
    });

    return NextResponse.json(
      {
        threads: threads.map((thread) => ({
          id: thread.id,
          name: thread.name,
          created_at: thread.created_at,
          owner_user_id: thread.owner,
          owner_username: thread.users.username,
        })),
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("groups_list_failed", error);
    return NextResponse.json(
      { error: { code: "groups_list_failed", message: "Failed to load groups." } },
      { status: 500 },
    );
  }
}
