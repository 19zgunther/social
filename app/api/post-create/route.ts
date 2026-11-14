import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { createPostForUser } from "@/app/lib/createPostForUser";
import { logErrorDump } from "@/app/lib/errorLog";
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
      void logErrorDump({
        userId: authResult.user_id,
        userName: authResult.username,
        key: "post_create",
        error: new Error(`${result.error.code}: ${result.error.message}`),
        context: {
          status: result.status,
          audience: body.audience ?? null,
          has_text: Boolean(body.text?.trim()),
          has_data: Boolean(body.data),
          has_legacy_image: Boolean(body.image_id || body.image_base64_data),
        },
      });
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.response, { status: 200 });
  } catch (error) {
    console.error("post_create_failed", error);
    void logErrorDump({
      userId: authResult.user_id,
      userName: authResult.username,
      key: "post_create",
      error,
    });
    return NextResponse.json(
      { error: { code: "post_create_failed", message: "Failed to create post." } },
      { status: 500 },
    );
  }
}
