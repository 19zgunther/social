import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";

type ThreadMemberRemoveBody = {
  thread_id?: string;
  user_id?: string;
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("thread_member_remove_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ThreadMemberRemoveBody;
    const threadId = body.thread_id?.trim();
    const userId = body.user_id?.trim();

    if (!threadId || !userId) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "thread_id and user_id are required." } },
        { status: 400 },
      );
    }

    const thread = await prisma.threads.findFirst({
      where: {
        id: threadId,
        OR: [
          { owner: authResult.user_id },
          { user_thread_access: { some: { user_id: authResult.user_id } } },
        ],
      },
      select: {
        id: true,
        owner: true,
      },
    });

    if (!thread) {
      return NextResponse.json(
        {
          error: {
            code: "forbidden",
            message: "You must be a member of the thread to remove users.",
          },
        },
        { status: 403 },
      );
    }

    if (userId === thread.owner) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "Owner cannot be removed from thread." } },
        { status: 400 },
      );
    }

    await prisma.user_thread_access.deleteMany({
      where: {
        thread_id: thread.id,
        user_id: userId,
      },
    });

    return NextResponse.json({ removed_user_id: userId }, { status: 200 });
  } catch (error) {
    console.error("thread_member_remove_failed", error);
    return NextResponse.json(
      { error: { code: "thread_member_remove_failed", message: "Failed to remove thread member." } },
      { status: 500 },
    );
  }
}
