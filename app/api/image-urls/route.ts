import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { getSignedMainBucketImageUrl } from "@/app/api/server_file_storage_utils";

type ImageUrlsRequest = {
  image_ids?: string[];
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("image_urls_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ImageUrlsRequest;
    const imageIds = (body.image_ids ?? []).map((value) => value.trim()).filter(Boolean);
    if (imageIds.length === 0) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "image_ids is required." } },
        { status: 400 },
      );
    }

    const imageUrlsById: Record<string, string | null> = {};
    await Promise.all(
      imageIds.map(async (imageId) => {
        try {
          imageUrlsById[imageId] = await getSignedMainBucketImageUrl({
            userId: authResult.user_id,
            imageId,
          });
        } catch (error) {
          console.error("image_urls_sign_failed", authResult.user_id, imageId, error);
          imageUrlsById[imageId] = null;
        }
      }),
    );

    return NextResponse.json({ image_urls_by_id: imageUrlsById }, { status: 200 });
  } catch (error) {
    console.error("image_urls_failed", error);
    return NextResponse.json(
      { error: { code: "image_urls_failed", message: "Failed to load image urls." } },
      { status: 500 },
    );
  }
}
