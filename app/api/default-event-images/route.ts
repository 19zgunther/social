import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import {
  defaultEventImageLabel,
  listDefaultEventImageKeys,
} from "@/app/lib/defaultEventImages";

export async function GET(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const keys = await listDefaultEventImageKeys();
    return NextResponse.json({
      images: keys.map((key) => ({
        key,
        label: defaultEventImageLabel(key),
        url: `/api/default-event-images/${encodeURIComponent(key)}`,
      })),
    });
  } catch (error) {
    console.error("default_event_images_list_failed", error);
    return NextResponse.json(
      {
        error: {
          code: "default_event_images_list_failed",
          message: "Failed to list default event images.",
        },
      },
      { status: 500 },
    );
  }
}
