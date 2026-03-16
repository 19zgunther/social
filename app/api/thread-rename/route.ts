import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";

type ThreadRenameBody = {
  thread_id?: string;
  name?: string;
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("thread_rename_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ThreadRenameBody;
    const threadId = body.thread_id?.trim();
    const name = body.name?.trim();

    if (!threadId || !name) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "thread_id and name are required.",
          },
        },
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
      },
    });

    if (!thread) {
      return NextResponse.json(
        {
          error: {
            code: "thread_not_found",
            message: "Thread not found or inaccessible.",
          },
        },
        { status: 404 },
      );
    }

    await prisma.threads.update({
      where: {
        id: thread.id,
      },
      data: {
        name,
      },
    });

    return NextResponse.json(
      {
        success: true,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("thread_rename_failed", error);
    return NextResponse.json(
      {
        error: {
          code: "thread_rename_failed",
          message: "Failed to rename thread.",
        },
      },
      { status: 500 },
    );
  }
}

