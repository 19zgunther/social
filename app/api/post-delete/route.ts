import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";

type PostDeleteBody = {
  post_id?: string;
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("post_delete_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as PostDeleteBody;
    const postId = body.post_id?.trim();
    if (!postId) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "post_id is required." } },
        { status: 400 },
      );
    }

    const post = await prisma.posts.findFirst({
      where: {
        id: postId,
      },
      select: {
        id: true,
        created_by: true,
      },
    });
    if (!post) {
      return NextResponse.json(
        { error: { code: "post_not_found", message: "Post not found." } },
        { status: 404 },
      );
    }

    const isAuthor = post.created_by === authResult.user_id;
    let ownsAuthorBot = false;
    if (!isAuthor) {
      const ownedBot = await prisma.bots.findFirst({
        where: {
          user_id: post.created_by,
          owner_id: authResult.user_id,
        },
        select: { id: true },
      });
      ownsAuthorBot = Boolean(ownedBot);
    }

    if (!isAuthor && !ownsAuthorBot) {
      return NextResponse.json(
        {
          error: {
            code: "not_allowed",
            message: "You can only delete your own posts (or posts from bots you own).",
          },
        },
        { status: 403 },
      );
    }

    await prisma.$transaction([
      prisma.user_post_access.deleteMany({
        where: { post_id: post.id },
      }),
      prisma.posts.delete({
        where: { id: post.id },
      }),
    ]);

    return NextResponse.json({ ok: true, post_id: post.id }, { status: 200 });
  } catch (error) {
    console.error("post_delete_failed", error);
    return NextResponse.json(
      { error: { code: "post_delete_failed", message: "Failed to delete post." } },
      { status: 500 },
    );
  }
}
