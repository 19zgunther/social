import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { logError } from "@/app/lib/errorLog";

type Body = {
  key?: string;
  message?: string;
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as Body;
    const key = typeof body.key === "string" ? body.key : "";
    const message = typeof body.message === "string" ? body.message : "";
    if (!key.trim() || !message.trim()) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "key and message are required.",
          },
        },
        { status: 400 },
      );
    }

    await logError({
      userId: authResult.user_id,
      userName: authResult.username,
      key,
      message,
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error("error_log_route_failed", error);
    return NextResponse.json(
      { error: { code: "error_log_failed", message: "Failed to log error." } },
      { status: 500 },
    );
  }
}
