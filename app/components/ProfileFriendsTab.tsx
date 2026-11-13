"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronRightIcon } from "@/app/components/Icons";
import FriendSearchButton from "@/app/components/FriendSearchButton";
import UserProfileImage from "@/app/components/UserProfileImage";
import { Button } from "@/app/ui-components";
import { cancelFriendRequest } from "@/app/lib/cancelFriendRequest";
import {
  AcceptedFriend,
  ApiError,
  FriendRequestsListResponse,
  IncomingFriendRequest,
  OutgoingFriendRequest,
} from "@/app/types/interfaces";

type ProfileFriendsTabProps = {
  userId: string;
  isActive: boolean;
  onViewUserProfile: (userId: string) => void;
  onAcceptedFriendsChange: (friends: AcceptedFriend[], isLoading: boolean) => void;
};

const postWithAuth = async (path: string, body: unknown): Promise<Response> =>
  fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as ApiError;
    return body.error?.message ?? "Request failed.";
  } catch {
    return "Request failed.";
  }
};

export default function ProfileFriendsTab({
  userId,
  isActive,
  onViewUserProfile,
  onAcceptedFriendsChange,
}: ProfileFriendsTabProps) {
  const [incomingRequests, setIncomingRequests] = useState<IncomingFriendRequest[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<OutgoingFriendRequest[]>([]);
  const [acceptedFriends, setAcceptedFriends] = useState<AcceptedFriend[]>([]);
  const [isLoadingFriendRows, setIsLoadingFriendRows] = useState(true);
  const [activeIncomingRequestId, setActiveIncomingRequestId] = useState<string | null>(null);
  const [activeOutgoingRequestId, setActiveOutgoingRequestId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  const pendingOutgoingRequests = outgoingRequests.filter((row) => row.accepted === null);

  const loadFriendRows = useCallback(async () => {
    setIsLoadingFriendRows(true);
    try {
      const response = await postWithAuth("/api/friend-requests-list", {});
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }

      const payload = (await response.json()) as FriendRequestsListResponse;
      setIncomingRequests(payload.incoming_requests);
      setOutgoingRequests(payload.outgoing_requests);
      setAcceptedFriends(payload.accepted_friends);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to load friend requests.");
    } finally {
      setIsLoadingFriendRows(false);
    }
  }, []);

  useEffect(() => {
    void loadFriendRows();
  }, [userId, loadFriendRows]);

  useEffect(() => {
    onAcceptedFriendsChange(acceptedFriends, isLoadingFriendRows);
  }, [acceptedFriends, isLoadingFriendRows, onAcceptedFriendsChange]);

  const onRespondToFriendRequest = async (friendId: string, accept: boolean) => {
    setActiveIncomingRequestId(friendId);
    setStatusMessage("");
    try {
      const response = await postWithAuth("/api/friend-request-respond", {
        friend_id: friendId,
        accept,
      });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }

      await loadFriendRows();
      setStatusMessage(accept ? "Friend request accepted." : "Friend request rejected.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to respond to request.");
    } finally {
      setActiveIncomingRequestId(null);
    }
  };

  const onCancelFriendRequest = async (friendId: string) => {
    setActiveOutgoingRequestId(friendId);
    setStatusMessage("");
    try {
      const result = await cancelFriendRequest({ friendId });
      if (result.ok) {
        await loadFriendRows();
      }
      setStatusMessage(result.message);
    } finally {
      setActiveOutgoingRequestId(null);
    }
  };

  if (!isActive) {
    return null;
  }

  return (
    <section className="w-full border-b border-border px-3">
      <div className="mt-3 w-full">
        <FriendSearchButton
          userId={userId}
          onViewUserProfile={onViewUserProfile}
          onFriendRequestSent={() => {
            void loadFriendRows();
          }}
          onStatusMessage={setStatusMessage}
        />
      </div>

      <div className="mt-5">
        {isLoadingFriendRows ? <p className="text-xs text-muted">Loading friends...</p> : null}

        {!isLoadingFriendRows && incomingRequests.length === 0 && acceptedFriends.length === 0 ? (
          <p className="text-xs text-muted">No friends or requests yet.</p>
        ) : null}

        <div className="space-y-2">
          {incomingRequests.length > 0 ? (
            <>
              <p className="mb-1 text-xs font-semibold text-muted">
                Incoming requests ({incomingRequests.length})
              </p>
              <div className="pt-2">
                {incomingRequests.map((requestRow) => (
                  <div
                    key={requestRow.id}
                    className="flex w-full items-center gap-4 border-b border-border/50 bg-bg px-3 py-3"
                  >
                    <UserProfileImage
                      userId={requestRow.requesting_user_id}
                      sizePx={50}
                      alt={`${requestRow.username} profile`}
                      username={requestRow.username}
                    />
                    <div className="min-w-0 flex-1 text-left">
                      <p className="truncate text-sm font-medium text-foreground">
                        {requestRow.username}
                      </p>
                      {requestRow.email ? (
                        <p className="truncate text-xs text-muted">{requestRow.email}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-2">
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={() => {
                          void onRespondToFriendRequest(requestRow.id, true);
                        }}
                        disabled={activeIncomingRequestId === requestRow.id}
                      >
                        Confirm
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          void onRespondToFriendRequest(requestRow.id, false);
                        }}
                        disabled={activeIncomingRequestId === requestRow.id}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          <p className="mb-1 text-xs font-semibold text-muted">
            Your friends ({acceptedFriends.length})
          </p>
          <div className="pt-2">
            {acceptedFriends.map((friend) => (
              <button
                key={friend.id}
                type="button"
                onClick={() => {
                  onViewUserProfile(friend.user_id);
                }}
                className="flex w-full items-center gap-4 border-b border-border/50 bg-bg px-3 py-2 transition hover:bg-surface"
              >
                <UserProfileImage
                  userId={friend.user_id}
                  sizePx={50}
                  alt={`${friend.username} profile`}
                  username={friend.username}
                />
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-medium text-foreground">{friend.username}</p>
                  {friend.email ? (
                    <p className="truncate text-xs text-muted">{friend.email}</p>
                  ) : null}
                </div>
                <ChevronRightIcon className="h-4 w-4 flex-shrink-0 text-muted" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {pendingOutgoingRequests.length > 0 ? (
        <div className="mt-3">
          <p className="mb-1 text-xs font-semibold text-muted">Pending sent requests</p>
          <div className="pt-2">
            {pendingOutgoingRequests.map((row) => (
              <div
                key={row.id}
                className="flex w-full items-center gap-4 border-b border-border/50 bg-bg px-3 py-3"
              >
                <UserProfileImage
                  userId={row.other_user_id}
                  sizePx={50}
                  alt={`${row.username} profile`}
                  username={row.username}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{row.username}</p>
                  {row.email ? (
                    <p className="truncate text-xs text-muted">{row.email}</p>
                  ) : null}
                  <p className="mt-0.5 text-xs text-muted">Pending</p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void onCancelFriendRequest(row.id);
                  }}
                  disabled={activeOutgoingRequestId === row.id}
                >
                  {activeOutgoingRequestId === row.id ? "Cancelling..." : "Cancel"}
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {statusMessage ? <p className="px-0 py-2 text-xs text-muted">{statusMessage}</p> : null}
    </section>
  );
}
