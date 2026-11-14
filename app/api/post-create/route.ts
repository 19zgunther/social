import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { createPostForUser } from "@/app/lib/createPostForUser";
import { logError } from "@/app/lib/errorLog";
import { PostCreateRequest } from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("post_create_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as PostCreateRequest;
    const result = await createPostForUser({
      authorUserId: authResult.user_id,
      authorUsername: authResult.username,
      authorEmail: authResult.email,
      body,
    });
    if (!result.ok) {
      void logError({
        userId: authResult.user_id,
        userName: authResult.username,
        key: "post_create",
        message: `${result.error.code}: ${result.error.message}`,
      });
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.response, { status: 200 });
  } catch (error) {
    console.error("post_create_failed", error);
    void logError({
      userId: authResult.user_id,
      userName: authResult.username,
      key: "post_create",
      message: error instanceof Error ? error.message : "Failed to create post.",
    });
    return NextResponse.json(
      { error: { code: "post_create_failed", message: "Failed to create post." } },
      { status: 500 },
    );
  }
}
