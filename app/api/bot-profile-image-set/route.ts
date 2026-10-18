import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { authCheck } from "@/app/api/auth_utils";
import {
  getSignedMainBucketImageUrl,
  uploadImageToMainBucket,
} from "@/app/api/server_file_storage_utils";
import { prisma } from "@/app/lib/prisma";
import { BotProfileImageSetRequest, ProfileImageSetResponse } from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as BotProfileImageSetRequest;
    const botId = body.bot_id?.trim() ?? "";
    const imageBase64Data = body.image_base64_data?.trim();
    const imageMimeType = body.image_mime_type?.trim();

    if (!botId) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "bot_id is required." } },
        { status: 400 },
      );
    }
    if (!imageBase64Data || !imageMimeType) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: "image_base64_data and image_mime_type are required.",
          },
        },
        { status: 400 },
      );
    }

    const bot = await prisma.bots.findFirst({
      where: { id: botId, owner_id: authResult.user_id },
      select: { user_id: true },
    });
    if (!bot) {
      return NextResponse.json(
        { error: { code: "bot_not_found", message: "Bot not found." } },
        { status: 404 },
      );
    }

    const imageId = randomUUID();
    await uploadImageToMainBucket({
      userId: bot.user_id,
      imageId,
      base64Data: imageBase64Data,
      mimeType: imageMimeType,
    });

    await prisma.users.update({
      where: { id: bot.user_id },
      data: { profile_image_id: imageId },
    });

    const imageUrl = await getSignedMainBucketImageUrl({
      userId: bot.user_id,
      imageId,
    });

    const payload: ProfileImageSetResponse = {
      profile_image_id: imageId,
      profile_image_url: imageUrl,
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("bot_profile_image_set_failed", error);
    return NextResponse.json(
      {
        error: {
          code: "bot_profile_image_set_failed",
          message: "Failed to set bot profile image.",
        },
      },
      { status: 500 },
    );
  }
}
