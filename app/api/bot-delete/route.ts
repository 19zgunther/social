import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { BotDeleteRequest, BotDeleteResponse } from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as BotDeleteRequest;
    const botId = body.bot_id?.trim() ?? "";
    if (!botId) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "bot_id is required." } },
        { status: 400 },
      );
    }

    const existing = await prisma.bots.findFirst({
      where: { id: botId, owner_id: authResult.user_id },
      select: { id: true, user_id: true },
    });
    if (!existing) {
      return NextResponse.json(
        { error: { code: "bot_not_found", message: "Bot not found." } },
        { status: 404 },
      );
    }

    const botUserId = existing.user_id;

    await prisma.$transaction(async (tx) => {
      const botPosts = await tx.posts.findMany({
        where: { created_by: botUserId },
        select: { id: true },
      });
      const botPostIds = botPosts.map((post) => post.id);

      if (botPostIds.length > 0) {
        await tx.user_post_access.deleteMany({
          where: { post_id: { in: botPostIds } },
        });
        await tx.posts.deleteMany({
          where: { id: { in: botPostIds } },
        });
      }

      await tx.user_post_access.deleteMany({
        where: { viewer_id: botUserId },
      });

      await tx.friends.deleteMany({
        where: {
          OR: [{ requesting_user: botUserId }, { other_user: botUserId }],
        },
      });

      await tx.shared_posts_contributors.deleteMany({
        where: {
          OR: [{ user_id: botUserId }, { invited_by: botUserId }],
        },
      });

      await tx.bot_logs.deleteMany({
        where: { bot_id: botId },
      });

      await tx.bots.delete({
        where: { id: botId },
      });

      await tx.users.delete({
        where: { id: botUserId },
      });
    });

    const payload: BotDeleteResponse = { ok: true, bot_id: botId };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("bot_delete_failed", error);
    return NextResponse.json(
      { error: { code: "bot_delete_failed", message: "Failed to delete bot." } },
      { status: 500 },
    );
  }
}
