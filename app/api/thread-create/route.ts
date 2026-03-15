import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";

type ThreadCreateBody = {
  name?: string;
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

      await tx.user_thread_access.create({
        data: {
          thread_id: thread.id,
          user_id: authResult.user_id,
          created_at: new Date(),
        },
      });

      return thread;
    });

    return NextResponse.json(
      {
        thread: {
          id: createdThread.id,
          name: createdThread.name,
          created_at: createdThread.created_at,
          owner_user_id: createdThread.owner,
          owner_username: authResult.username,
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
