import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import {
  verifyMainBucketImageAccessGrant,
  verifyThreadBucketImageAccessGrant,
} from "@/app/api/image_access_grant";
import {
  getSignedMainBucketImageUrl,
  getSignedMainBucketThreadImageUrl,
} from "@/app/api/server_file_storage_utils";

type Body = {
  image_id?: string;
  storage_user_id?: string;
  thread_id?: string;
  grant?: string;
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as Body;
    const imageId = body.image_id?.trim() ?? "";
    const storageUserId = body.storage_user_id?.trim() ?? "";
    const threadId = body.thread_id?.trim() ?? "";
    const grant = body.grant?.trim() ?? "";

    if (!imageId || !grant) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "image_id and grant are required." } },
        { status: 400 },
      );
    }

    const mainPayload = verifyMainBucketImageAccessGrant(grant);
    if (mainPayload) {
      if (!storageUserId) {
        return NextResponse.json(
          { error: { code: "invalid_request", message: "storage_user_id is required for this grant." } },
          { status: 400 },
        );
      }
      if (mainPayload.i !== imageId || mainPayload.o !== storageUserId) {
        return NextResponse.json(
          { error: { code: "grant_mismatch", message: "Grant does not match image or owner." } },
          { status: 403 },
        );
      }
      if (mainPayload.w !== authResult.user_id) {
        return NextResponse.json(
          { error: { code: "grant_viewer_mismatch", message: "Grant was issued for a different user." } },
          { status: 403 },
        );
      }
      if (Date.now() > mainPayload.e) {
        return NextResponse.json(
          { error: { code: "grant_expired", message: "Image access grant has expired." } },
          { status: 403 },
        );
      }
      const signedUrl = await getSignedMainBucketImageUrl({
        userId: storageUserId,
        imageId,
      });
      return NextResponse.json({ signed_url: signedUrl }, { status: 200 });
    }

    const threadPayload = verifyThreadBucketImageAccessGrant(grant);
    if (threadPayload) {
      if (!threadId) {
        return NextResponse.json(
          { error: { code: "invalid_request", message: "thread_id is required for this grant." } },
          { status: 400 },
        );
      }
      if (threadPayload.i !== imageId || threadPayload.t !== threadId) {
        return NextResponse.json(
          { error: { code: "grant_mismatch", message: "Grant does not match image or thread." } },
          { status: 403 },
        );
      }
      if (threadPayload.w !== authResult.user_id) {
        return NextResponse.json(
          { error: { code: "grant_viewer_mismatch", message: "Grant was issued for a different user." } },
          { status: 403 },
        );
      }
      if (Date.now() > threadPayload.e) {
        return NextResponse.json(
          { error: { code: "grant_expired", message: "Image access grant has expired." } },
          { status: 403 },
        );
      }
      const signedUrl = await getSignedMainBucketThreadImageUrl({
        threadId,
        imageId,
      });
      return NextResponse.json({ signed_url: signedUrl }, { status: 200 });
    }

    return NextResponse.json(
      { error: { code: "invalid_grant", message: "Invalid image access grant." } },
      { status: 403 },
    );
  } catch (error) {
    console.error("image_resolve_failed", error);
    return NextResponse.json(
      { error: { code: "image_resolve_failed", message: "Failed to resolve image URL." } },
      { status: 500 },
    );
  }
}
