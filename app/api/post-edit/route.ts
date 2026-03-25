import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { PostEditRequest, PostEditResponse } from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("post_edit_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as PostEditRequest;
    const postId = body.post_id?.trim();
    if (!postId) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "post_id is required." } },
        { status: 400 },
      );
    }

    const post = await prisma.posts.findFirst({
      where: { id: postId },
      select: {
        id: true,
        created_by: true,
        image_id: true,
      },
    });
    if (!post) {
      return NextResponse.json(
        { error: { code: "post_not_found", message: "Post not found." } },
        { status: 404 },
      );
    }
    if (post.created_by !== authResult.user_id) {
      return NextResponse.json(
        { error: { code: "not_allowed", message: "You can only edit your own posts." } },
        { status: 403 },
      );
    }

    const nextText = body.text ?? "";
    if (!post.image_id && !nextText.trim()) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "Post text cannot be empty." } },
        { status: 400 },
      );
    }

    const updated = await prisma.posts.update({
      where: { id: post.id },
      data: {
        text: nextText.trim().length > 0 ? nextText : null,
      },
      select: {
        id: true,
        text: true,
      },
    });

    const payload: PostEditResponse = {
      post: {
        id: updated.id,
        text: updated.text ?? "",
      },
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("post_edit_failed", error);
    return NextResponse.json(
      { error: { code: "post_edit_failed", message: "Failed to edit post." } },
      { status: 500 },
    );
  }
}
