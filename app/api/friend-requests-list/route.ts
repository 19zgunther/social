import { NextResponse } from "next/server";
import { authCheck } from "@/app/api/auth_utils";
import { prisma } from "@/app/lib/prisma";
import { getSignedMainBucketImageUrl } from "@/app/api/server_file_storage_utils";
import { FriendRequestsListResponse } from "@/app/types/interfaces";

export async function POST(request: Request) {
  const authResult = authCheck(request);
  if (authResult.error) {
    console.error("friend_requests_list_auth_failed", authResult.error);
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const incoming = await prisma.friends.findMany({
      where: {
        other_user: authResult.user_id,
        accepted: null,
      },
      orderBy: [{ requested_at: "desc" }, { id: "desc" }],
      select: {
        id: true,
        requesting_user: true,
        requested_at: true,
        users_friends_requesting_userTousers: {
          select: {
            username: true,
            email: true,
            profile_image_id: true,
          },
        },
      },
    });

    const outgoing = await prisma.friends.findMany({
      where: {
        requesting_user: authResult.user_id,
      },
      orderBy: [{ requested_at: "desc" }, { id: "desc" }],
      select: {
        id: true,
        other_user: true,
        requested_at: true,
        accepted: true,
        accepted_at: true,
        users_friends_other_userTousers: {
          select: {
            username: true,
            email: true,
            profile_image_id: true,
          },
        },
      },
    });

    const acceptedRows = await prisma.friends.findMany({
      where: {
        accepted: true,
        OR: [{ requesting_user: authResult.user_id }, { other_user: authResult.user_id }],
      },
      orderBy: [{ accepted_at: "desc" }, { requested_at: "desc" }, { id: "desc" }],
      select: {
        id: true,
        requesting_user: true,
        other_user: true,
        accepted_at: true,
        users_friends_requesting_userTousers: {
          select: {
            id: true,
            username: true,
            email: true,
            profile_image_id: true,
          },
        },
        users_friends_other_userTousers: {
          select: {
            id: true,
            username: true,
            email: true,
            profile_image_id: true,
          },
        },
      },
    });

    const payload: FriendRequestsListResponse = {
      incoming_requests: incoming.map((row) => ({
        id: row.id,
        requesting_user_id: row.requesting_user,
        requested_at: row.requested_at.toISOString(),
        username: row.users_friends_requesting_userTousers.username,
        email: row.users_friends_requesting_userTousers.email,
      })),
      outgoing_requests: outgoing.map((row) => ({
        id: row.id,
        other_user_id: row.other_user,
        requested_at: row.requested_at.toISOString(),
        accepted: row.accepted,
        accepted_at: row.accepted_at?.toISOString() ?? null,
        username: row.users_friends_other_userTousers.username,
        email: row.users_friends_other_userTousers.email,
        profile_image_id: row.users_friends_other_userTousers.profile_image_id,
        profile_image_url: null,
      })),
      accepted_friends: acceptedRows.map((row) => {
        const other =
          row.requesting_user === authResult.user_id
            ? row.users_friends_other_userTousers
            : row.users_friends_requesting_userTousers;
        return {
          id: row.id,
          user_id: other.id,
          username: other.username,
          email: other.email,
          accepted_at: row.accepted_at?.toISOString() ?? null,
          profile_image_id: other.profile_image_id,
          profile_image_url: null,
        };
      }),
    };

    const friendsWithImages = await Promise.all(
      payload.accepted_friends.map(async (friend) => {
        if (!friend.profile_image_id) {
          return friend;
        }
        try {
          const signedUrl = await getSignedMainBucketImageUrl({
            userId: friend.user_id,
            imageId: friend.profile_image_id,
          });
          return { ...friend, profile_image_url: signedUrl };
        } catch (error) {
          console.error("friend_profile_image_sign_failed", friend.user_id, error);
          return friend;
        }
      }),
    );

    const outgoingWithImages = await Promise.all(
      payload.outgoing_requests.map(async (request) => {
        if (!request.profile_image_id) {
          return request;
        }
        try {
          const signedUrl = await getSignedMainBucketImageUrl({
            userId: request.other_user_id,
            imageId: request.profile_image_id,
          });
          return { ...request, profile_image_url: signedUrl };
        } catch (error) {
          console.error("outgoing_request_profile_image_sign_failed", request.other_user_id, error);
          return request;
        }
      }),
    );

    payload.accepted_friends = friendsWithImages;
    payload.outgoing_requests = outgoingWithImages;

    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("friend_requests_list_failed", error);
    return NextResponse.json(
      { error: { code: "friend_requests_list_failed", message: "Failed to load friend requests." } },
      { status: 500 },
    );
  }
}
