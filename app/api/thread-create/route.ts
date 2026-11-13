import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";

type ThreadCreateBody = {
  name?: string;
  member_user_ids?: string[];
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("thread_create_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ThreadCreateBody;
    const name = body.name?.trim();

    if (!name) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "Thread name is required." } },
        { status: 400 },
      );
    }

    const requestedMemberIds = Array.isArray(body.member_user_ids)
      ? [
          ...new Set(
            body.member_user_ids
              .filter((id): id is string => typeof id === "string")
              .map((id) => id.trim())
              .filter((id) => id.length > 0 && id !== authResult.user_id),
          ),
        ]
      : [];

    const validMembers =
      requestedMemberIds.length > 0
        ? await prisma.users.findMany({
            where: { id: { in: requestedMemberIds } },
            select: { id: true, username: true },
          })
        : [];

    const createdThread = await prisma.$transaction(async (tx) => {
      const thread = await tx.threads.create({
        data: {
          owner: authResult.user_id,
          name,
        },
        select: {
          id: true,
          name: true,
          owner: true,
          created_at: true,
        },
      });

      await tx.user_thread_access.createMany({
        data: [
          {
            thread_id: thread.id,
            user_id: authResult.user_id,
            created_at: new Date(),
          },
          ...validMembers.map((member) => ({
            thread_id: thread.id,
            user_id: member.id,
            created_at: new Date(),
          })),
        ],
      });

      return thread;
    });

    const memberUserIds = [authResult.user_id, ...validMembers.map((member) => member.id)];
    const memberUsernames = [
      authResult.username,
      ...validMembers.map((member) => member.username),
    ];

    return NextResponse.json(
      {
        thread: {
          id: createdThread.id,
          name: createdThread.name,
          created_at: createdThread.created_at,
          owner_user_id: createdThread.owner,
          owner_username: authResult.username,
          member_user_ids: memberUserIds,
          member_usernames: memberUsernames,
          user_pinned_thread: false,
          image_id: null,
          image_url: null,
          image_access_grant: null,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("thread_create_failed", error);
    return NextResponse.json(
      { error: { code: "thread_create_failed", message: "Failed to create thread." } },
      { status: 500 },
    );
  }
}
