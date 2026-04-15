import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { getSignedMainBucketImageUrl } from "@/app/api/server_file_storage_utils";
import { threadMemberFriendshipStatusForPair } from "@/app/lib/threadMemberFriendship";

type ThreadMemberAddBody = {
  thread_id?: string;
  event_id?: string;
  identifier?: string;
};

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("thread_member_add_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ThreadMemberAddBody;
    const threadId = body.thread_id?.trim();
    const eventId = body.event_id?.trim();
    const identifier = body.identifier?.trim();

    if (!threadId || !identifier) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "thread_id and identifier are required." } },
        { status: 400 },
      );
    }

    const thread = await prisma.threads.findFirst({
      where: {
        id: threadId,
        OR: [
          { owner: authResult.user_id },
          { user_thread_access: { some: { user_id: authResult.user_id } } },
        ],
      },
      select: {
        id: true,
        owner: true,
      },
    });

    if (!thread) {
      return NextResponse.json(
        { error: { code: "forbidden", message: "You must be a member of the thread to add users." } },
        { status: 403 },
      );
    }

    if (eventId) {
      const event = await prisma.thread_events.findFirst({
        where: {
          id: eventId,
          thread_id: thread.id,
        },
        select: {
          id: true,
        },
      });
      if (!event) {
        return NextResponse.json(
          { error: { code: "event_not_found", message: "Event not found for this thread." } },
          { status: 404 },
        );
      }
      if (thread.owner !== authResult.user_id) {
        return NextResponse.json(
          { error: { code: "forbidden", message: "Only the event owner can add users." } },
          { status: 403 },
        );
      }
    }

    const user = await prisma.users.findFirst({
      where: {
        OR: [{ username: identifier }, { email: identifier.toLowerCase() }],
      },
      select: {
        id: true,
        username: true,
        email: true,
        profile_image_id: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: { code: "user_not_found", message: "User not found." } },
        { status: 404 },
      );
    }

    const existingAccess = await prisma.user_thread_access.findFirst({
      where: {
        thread_id: thread.id,
        user_id: user.id,
      },
      select: {
        id: true,
      },
    });

    if (!existingAccess) {
      await prisma.user_thread_access.create({
        data: {
          thread_id: thread.id,
          user_id: user.id,
          created_at: new Date(),
        },
      });
    }

    let profile_image_url: string | null = null;
    if (user.profile_image_id) {
      try {
        profile_image_url = await getSignedMainBucketImageUrl({
          userId: user.id,
          imageId: user.profile_image_id,
        });
      } catch (error) {
        console.error("thread_member_add_profile_image_sign_failed", user.id, error);
      }
    }

    const friendship_status = await threadMemberFriendshipStatusForPair(
      authResult.user_id,
      user.id,
    );

    return NextResponse.json(
      {
        member: {
          user_id: user.id,
          username: user.username,
          email: user.email,
          is_owner: user.id === thread.owner,
          profile_image_id: user.profile_image_id,
          profile_image_url,
          friendship_status,
        },
        already_member: Boolean(existingAccess),
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("thread_member_add_failed", error);
    return NextResponse.json(
      { error: { code: "thread_member_add_failed", message: "Failed to add thread member." } },
      { status: 500 },
    );
  }
}
