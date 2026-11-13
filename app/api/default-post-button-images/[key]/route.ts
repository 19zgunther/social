import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { readDefaultPostButtonImageFile } from "@/app/lib/defaultPostButtonImages";

type RouteContext = {
  params: Promise<{ key: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const authResult = authCheck(request);
  if (authResult.error) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const { key: rawKey } = await context.params;
    const key = decodeURIComponent(rawKey ?? "").trim();
    const file = await readDefaultPostButtonImageFile(key);
    if (!file) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Default post button image not found." } },
        { status: 404 },
      );
    }

    return new NextResponse(new Uint8Array(file.buffer), {
      status: 200,
      headers: {
        "Content-Type": file.mimeType,
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch (error) {
    console.error("default_post_button_image_serve_failed", error);
    return NextResponse.json(
      {
        error: {
          code: "default_post_button_image_serve_failed",
          message: "Failed to load default post button image.",
        },
      },
      { status: 500 },
    );
  }
}
