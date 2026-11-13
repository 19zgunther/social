import type { ApiError } from "@/app/types/interfaces";

export type CancelFriendRequestInput =
  | { friendId: string }
  | { otherUserId: string };

export type CancelFriendRequestResult =
  | { ok: true; cancelled: boolean; message: string }
  | { ok: false; message: string; status: number };

export async function cancelFriendRequest(
  input: CancelFriendRequestInput,
): Promise<CancelFriendRequestResult> {
  try {
    const body =
      "friendId" in input
        ? { friend_id: input.friendId }
        : { other_user_id: input.otherUserId };

    const response = await fetch("/api/friend-request-cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let message = "Failed to cancel friend request.";
      try {
        const errorBody = (await response.json()) as ApiError;
        message = errorBody.error?.message ?? message;
      } catch {
        // keep default message
      }
      return { ok: false, message, status: response.status };
    }

    const payload = (await response.json()) as { cancelled?: boolean };
    const cancelled = payload.cancelled !== false;
    return {
      ok: true,
      cancelled,
      message: cancelled
        ? "Friend request cancelled."
        : "Friend request was already accepted.",
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Failed to cancel friend request.",
      status: 0,
    };
  }
}
