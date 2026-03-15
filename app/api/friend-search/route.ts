import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";

type FriendSearchBody = {
  query?: string;
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("friend_search_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as FriendSearchBody;
    const query = body.query?.trim();
    if (!query) {
      return NextResponse.json({ users: [] }, { status: 200 });
    }

    const users = await prisma.users.findMany({
      where: {
        id: {
          not: authResult.user_id,
        },
        OR: [{ username: { contains: query } }, { email: { contains: query } }],
      },
      orderBy: [{ username: "asc" }, { id: "asc" }],
      take: 20,
      select: {
        id: true,
        username: true,
        email: true,
      },
    });

    const userIds = users.map((user) => user.id);
    const relatedFriendRows = userIds.length
      ? await prisma.friends.findMany({
          where: {
            OR: [
              {
                requesting_user: authResult.user_id,
                other_user: { in: userIds },
              },
              {
                other_user: authResult.user_id,
                requesting_user: { in: userIds },
              },
            ],
          },
          select: {
            id: true,
            requesting_user: true,
            other_user: true,
            accepted: true,
          },
        })
      : [];

    const relationByOtherUserId = new Map<
      string,
      {
        id: string;
        direction: "outgoing" | "incoming";
        accepted: boolean | null;
      }
    >();
    for (const row of relatedFriendRows) {
      if (row.requesting_user === authResult.user_id) {
        relationByOtherUserId.set(row.other_user, {
          id: row.id,
          direction: "outgoing",
          accepted: row.accepted,
        });
      } else {
        relationByOtherUserId.set(row.requesting_user, {
          id: row.id,
          direction: "incoming",
          accepted: row.accepted,
        });
      }
    }

    return NextResponse.json(
      {
        users: users.map((user) => {
          const relation = relationByOtherUserId.get(user.id);
          return {
            id: user.id,
            username: user.username,
            email: user.email,
            relation: relation
              ? {
                  id: relation.id,
                  direction: relation.direction,
                  accepted: relation.accepted,
                }
              : null,
          };
        }),
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("friend_search_failed", error);
    return NextResponse.json(
      { error: { code: "friend_search_failed", message: "Failed to search users." } },
      { status: 500 },
    );
  }
}
