import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";

type ThreadMemberAddBody = {
  thread_id?: string;
  identifier?: string;
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("thread_member_add_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ThreadMemberAddBody;
    const threadId = body.thread_id?.trim();
    const identifier = body.identifier?.trim();

    if (!threadId || !identifier) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "thread_id and identifier are required." } },
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
        { error: { code: "forbidden", message: "You must be a member of the thread to add users." } },
        { status: 403 },
      );
    }

    const user = await prisma.users.findFirst({
      where: {
        OR: [{ username: identifier }, { email: identifier.toLowerCase() }],
      },
      select: {
        id: true,
        username: true,
        email: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: { code: "user_not_found", message: "User not found." } },
        { status: 404 },
      );
    }

    const existingAccess = await prisma.user_thread_access.findFirst({
      where: {
        thread_id: thread.id,
        user_id: user.id,
      },
      select: {
        id: true,
      },
    });

    if (!existingAccess) {
      await prisma.user_thread_access.create({
        data: {
          thread_id: thread.id,
          user_id: user.id,
          created_at: new Date(),
        },
      });
    }

    return NextResponse.json(
      {
        member: {
          user_id: user.id,
          username: user.username,
          email: user.email,
          is_owner: user.id === thread.owner,
        },
        already_member: Boolean(existingAccess),
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("thread_member_add_failed", error);
    return NextResponse.json(
      { error: { code: "thread_member_add_failed", message: "Failed to add thread member." } },
      { status: 500 },
    );
  }
}
