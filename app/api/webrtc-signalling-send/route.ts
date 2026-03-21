import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUuid = (value: string): boolean => UUID_RE.test(value);

type SignalBody = {
  thread_id?: string;
  call_session_id?: string;
  payload?: unknown;
};

const isVideoCallPayload = (raw: unknown): raw is Record<string, unknown> => {
  if (!raw || typeof raw !== "object") {
    return false;
  }
  const type = (raw as { type?: unknown }).type;
  return type === "offer" || type === "answer" || type === "ice";
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("webrtc_signalling_send_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as SignalBody;
    const threadId = body.thread_id?.trim();
    const callSessionId = body.call_session_id?.trim();

    if (!threadId || !isUuid(threadId)) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "thread_id is required." } },
        { status: 400 },
      );
    }

    if (!callSessionId || !isUuid(callSessionId)) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "call_session_id is required." } },
        { status: 400 },
      );
    }

    if (!isVideoCallPayload(body.payload)) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "payload must be a WebRTC signal object." } },
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

    const normalizedPayload = {
      ...body.payload,
      from_user_id: authResult.user_id,
    } as Prisma.InputJsonValue;

    const row = await prisma.webrtc_signalling.create({
      data: {
        thread_id: threadId,
        call_session_id: callSessionId,
        from_user_id: authResult.user_id,
        payload: normalizedPayload,
      },
      select: {
        id: true,
        created_at: true,
      },
    });

    return NextResponse.json(
      {
        id: row.id,
        created_at: row.created_at.toISOString(),
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("webrtc_signalling_send_failed", error);
    return NextResponse.json(
      { error: { code: "webrtc_signalling_send_failed", message: "Failed to store signal." } },
      { status: 500 },
    );
  }
}
