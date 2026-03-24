import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { getSignedMainBucketImageUrl } from "@/app/api/server_file_storage_utils";
import { threadMemberFriendshipStatusesForMany } from "@/app/lib/threadMemberFriendship";
import { ThreadMembersRequest, ThreadMembersResponse } from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("thread_members_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ThreadMembersRequest;
    const threadId = body.thread_id?.trim();

    if (!threadId) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "thread_id is required." } },
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
        { error: { code: "thread_not_found", message: "Thread not found or inaccessible." } },
        { status: 404 },
      );
    }

    const members = await prisma.user_thread_access.findMany({
      where: {
        thread_id: thread.id,
      },
      orderBy: {
        created_at: "asc",
      },
      select: {
        user_id: true,
        users: {
          select: {
            username: true,
            email: true,
            profile_image_id: true,
          },
        },
      },
    });

    const membersPayload = members.map((member) => ({
      user_id: member.user_id,
      username: member.users.username,
      email: member.users.email,
      is_owner: member.user_id === thread.owner,
      profile_image_id: member.users.profile_image_id,
      profile_image_url: null as string | null,
    }));

    const membersWithImages = await Promise.all(
      membersPayload.map(async (row) => {
        if (!row.profile_image_id) {
          return row;
        }
        try {
          const signedUrl = await getSignedMainBucketImageUrl({
            userId: row.user_id,
            imageId: row.profile_image_id,
          });
          return { ...row, profile_image_url: signedUrl };
        } catch (error) {
          console.error("thread_member_profile_image_sign_failed", row.user_id, error);
          return row;
        }
      }),
    );

    const friendshipByUserId = await threadMemberFriendshipStatusesForMany(
      authResult.user_id,
      membersWithImages.map((m) => m.user_id),
    );

    const membersWithFriendship = membersWithImages.map((row) => ({
      ...row,
      friendship_status: friendshipByUserId.get(row.user_id) ?? "none",
    }));

    const payload: ThreadMembersResponse = {
      thread_id: thread.id,
      is_owner: thread.owner === authResult.user_id,
      members: membersWithFriendship,
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("thread_members_failed", error);
    return NextResponse.json(
      { error: { code: "thread_members_failed", message: "Failed to load thread members." } },
      { status: 500 },
    );
  }
}
