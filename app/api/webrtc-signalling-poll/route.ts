import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUuid = (value: string): boolean => UUID_RE.test(value);

const POLL_LIMIT = 100;

type PollBody = {
  thread_id?: string;
  call_session_id?: string | null;
  not_before?: string;
  cursor?: { created_at: string; id: string } | null;
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("webrtc_signalling_poll_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as PollBody;
    const threadId = body.thread_id?.trim();
    const callSessionId =
      typeof body.call_session_id === "string" ? body.call_session_id.trim() : null;

    if (!threadId || !isUuid(threadId)) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "thread_id is required." } },
        { status: 400 },
      );
    }

    if (callSessionId && !isUuid(callSessionId)) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "call_session_id must be a valid UUID." } },
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
      select: { id: true },
    });

    if (!thread) {
      return NextResponse.json(
        { error: { code: "thread_not_found", message: "Thread not found or inaccessible." } },
        { status: 404 },
      );
    }

    const cursor = body.cursor;
    const notBefore = body.not_before?.trim();

    if (!cursor && !notBefore) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "Provide cursor for incremental poll or not_before for the first poll.",
          },
        },
        { status: 400 },
      );
    }

    if (!cursor && notBefore) {
      const parsed = new Date(notBefore);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json(
          { error: { code: "invalid_request", message: "not_before must be a valid ISO date." } },
          { status: 400 },
        );
      }
    }

    if (cursor) {
      const parsed = new Date(cursor.created_at);
      if (Number.isNaN(parsed.getTime()) || !isUuid(cursor.id)) {
        return NextResponse.json(
          { error: { code: "invalid_request", message: "cursor has invalid created_at or id." } },
          { status: 400 },
        );
      }
    }

    const where: Prisma.webrtc_signallingWhereInput = {
      thread_id: threadId,
    };

    if (callSessionId) {
      where.call_session_id = callSessionId;
    }

    if (cursor) {
      const cursorDate = new Date(cursor.created_at);
      where.AND = [
        {
          OR: [
            { created_at: { gt: cursorDate } },
            {
              AND: [{ created_at: cursorDate }, { id: { gt: cursor.id } }],
            },
          ],
        },
      ];
    } else if (notBefore) {
      where.created_at = { gte: new Date(notBefore) };
    }

    const rows = await prisma.webrtc_signalling.findMany({
      where,
      orderBy: [{ created_at: "asc" }, { id: "asc" }],
      take: POLL_LIMIT,
      select: {
        id: true,
        call_session_id: true,
        from_user_id: true,
        created_at: true,
        payload: true,
      },
    });

    return NextResponse.json(
      {
        signals: rows.map((row) => ({
          id: row.id,
          call_session_id: row.call_session_id,
          from_user_id: row.from_user_id,
          created_at: row.created_at.toISOString(),
          payload: row.payload,
        })),
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("webrtc_signalling_poll_failed", error);
    return NextResponse.json(
      { error: { code: "webrtc_signalling_poll_failed", message: "Failed to load signals." } },
      { status: 500 },
    );
  }
}
