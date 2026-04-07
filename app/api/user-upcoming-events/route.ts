import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { createThreadBucketImageAccessGrant } from "@/app/api/image_access_grant";
import { prisma } from "@/app/lib/prisma";
import { finalizeThreadEventItem, type ThreadEventRow } from "@/app/lib/threadEvents";
import type { ThreadItem, UserUpcomingEventsResponse } from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("user_upcoming_events_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  const userId = authResult.user_id;

  try {
    void (await request.json().catch(() => ({})));

    const now = new Date();
    const rows = await prisma.thread_events.findMany({
      where: {
        ends_at: { gt: now },
        threads: {
          OR: [{ owner: userId }, { user_thread_access: { some: { user_id: userId } } }],
        },
      },
      include: {
        threads: {
          select: {
            id: true,
            name: true,
            created_at: true,
            owner: true,
            image_id: true,
            users: { select: { username: true } },
            user_thread_access: { select: { user_id: true } },
          },
        },
      },
      orderBy: { starts_at: "asc" },
    });

    const items: UserUpcomingEventsResponse["items"] = [];

    for (const row of rows) {
      const tr = row.threads;
      const { threads: _t, ...eventRow } = row;
      const event = await finalizeThreadEventItem(eventRow as ThreadEventRow, userId);

      const participantCount = new Set([tr.owner, ...tr.user_thread_access.map((a) => a.user_id)]).size;

      let image_access_grant: string | null = null;
      if (tr.image_id) {
        try {
          image_access_grant = createThreadBucketImageAccessGrant({
            threadId: tr.id,
            imageId: tr.image_id,
            viewerUserId: userId,
          });
        } catch (error) {
          console.error("user_upcoming_events_thread_image_grant_failed", tr.id, error);
        }
      }

      const thread: ThreadItem = {
        id: tr.id,
        name: tr.name,
        created_at: tr.created_at.toISOString(),
        owner_user_id: tr.owner,
        owner_username: tr.users.username,
        participant_count: participantCount,
        image_id: tr.image_id,
        image_url: null,
        image_access_grant,
        last_message_at: null,
        last_photo_preview: null,
      };

      items.push({ thread, event });
    }

    const payload: UserUpcomingEventsResponse = { items };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("user_upcoming_events_failed", error);
    return NextResponse.json(
      { error: { code: "user_upcoming_events_failed", message: "Failed to load upcoming events." } },
      { status: 500 },
    );
  }
}
