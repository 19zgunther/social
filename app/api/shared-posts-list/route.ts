import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import {
  getSharedPostPhase,
  serializeSharedPostListItem,
  sharedPostSelectForSerialize,
} from "@/app/lib/sharedPosts";
import type { SharedPostsListResponse } from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("shared_posts_list_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const rows = await prisma.shared_posts.findMany({
      where: {
        shared_posts_contributors: {
          some: { user_id: authResult.user_id },
        },
      },
      orderBy: [{ release_at: "desc" }, { created_at: "desc" }],
      select: sharedPostSelectForSerialize,
    });

    const payload: SharedPostsListResponse = {
      open: [],
      pending: [],
      released: [],
    };

    for (const row of rows) {
      const item = serializeSharedPostListItem({
        row,
        viewerUserId: authResult.user_id,
      });
      const phase = getSharedPostPhase(row.close_at, row.release_at);
      if (phase === "open") {
        payload.open.push(item);
      } else if (phase === "pending") {
        payload.pending.push(item);
      } else {
        payload.released.push(item);
      }
    }

    payload.open.sort((a, b) => b.close_at.localeCompare(a.close_at));
    payload.pending.sort((a, b) => a.release_at.localeCompare(b.release_at));
    payload.released.sort((a, b) => b.release_at.localeCompare(a.release_at));

    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("shared_posts_list_failed", error);
    return NextResponse.json(
      { error: { code: "shared_posts_list_failed", message: "Failed to load shared posts." } },
      { status: 500 },
    );
  }
}
