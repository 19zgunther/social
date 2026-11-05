"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronRightIcon, CloseIcon } from "@/app/components/Icons";
import UserProfileImage from "@/app/components/UserProfileImage";
import AnimatedModal, { useAnimatedModal } from "@/app/components/utils/AnimatedModal";
import UserSearch, { UserSearchOption } from "@/app/components/UserSearch";
import { Button, IconButton } from "@/app/ui-components";
import {
  AcceptedFriend,
  ApiError,
  FriendRequestsListResponse,
  FriendSearchResponse,
  FriendSearchResult,
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
  const [friendSearchQuery, setFriendSearchQuery] = useState("");
  const [incomingRequests, setIncomingRequests] = useState<IncomingFriendRequest[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<OutgoingFriendRequest[]>([]);
  const [acceptedFriends, setAcceptedFriends] = useState<AcceptedFriend[]>([]);
  const [isLoadingFriendRows, setIsLoadingFriendRows] = useState(true);
  const [activeFriendUserId, setActiveFriendUserId] = useState<string | null>(null);
  const [activeIncomingRequestId, setActiveIncomingRequestId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const {
    isPresented: isFriendSearchPresented,
    isClosing: isFriendSearchClosing,
    open: openFriendSearch,
    close: closeFriendSearch,
  } = useAnimatedModal();

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

  const runFriendSearch = useCallback(async (rawQuery: string): Promise<FriendSearchResult[]> => {
    const query = rawQuery.trim();

    try {
      const response = await postWithAuth("/api/friend-search", {
        query: query || undefined,
      });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return [];
      }

      const payload = (await response.json()) as FriendSearchResponse;
      return payload.users;
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to search users.");
      return [];
    }
  }, []);

  const searchFriendOptions = useCallback(
    async (query: string): Promise<UserSearchOption[]> => {
      const users = await runFriendSearch(query);
      return users.map((user) => {
        const relation = user.relation;
        const friendshipStatus: UserSearchOption["friendshipStatus"] =
          user.id === userId
            ? "self"
            : relation
              ? relation.accepted === true
                ? "friends"
                : relation.accepted === false
                  ? "rejected"
                  : relation.direction === "incoming"
                    ? "pending_received"
                    : "pending_sent"
              : "none";

        const hint =
          friendshipStatus === "friends"
            ? "Friends"
            : friendshipStatus === "pending_sent"
              ? "Pending request"
              : friendshipStatus === "pending_received"
                ? "Incoming request"
                : friendshipStatus === "self"
                  ? "You"
                  : "Not friends";

        return {
          id: user.id,
          username: user.username,
          email: user.email,
          hint,
          friendshipStatus,
        };
      });
    },
    [runFriendSearch, userId],
  );

  const onSelectUserFromSearch = useCallback(
    (option: UserSearchOption) => {
      setFriendSearchQuery(option.username);
      if (option.hint) {
        setStatusMessage(option.hint);
      }
      closeFriendSearch();
      if (option.id !== userId) {
        onViewUserProfile(option.id);
      }
    },
    [userId, onViewUserProfile, closeFriendSearch],
  );

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

      await Promise.all([loadFriendRows(), runFriendSearch(friendSearchQuery)]);
      setStatusMessage(accept ? "Friend request accepted." : "Friend request rejected.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to respond to request.");
    } finally {
      setActiveIncomingRequestId(null);
    }
  };

  const onRequestFollowFromSearch = useCallback(
    async (option: UserSearchOption): Promise<UserSearchOption | void> => {
      if (
        option.friendshipStatus === "self" ||
        option.friendshipStatus === "friends" ||
        option.friendshipStatus === "pending_sent" ||
        option.friendshipStatus === "pending_received"
      ) {
        return option;
      }

      setActiveFriendUserId(option.id);
      setStatusMessage("");
      try {
        const response = await postWithAuth("/api/friend-request-create", {
          other_user_id: option.id,
        });
        if (!response.ok) {
          setStatusMessage(await readErrorMessage(response));
          return;
        }

        await loadFriendRows();
        setStatusMessage("Friend request sent.");
        return {
          ...option,
          hint: "Pending request",
          friendshipStatus: "pending_sent",
        };
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : "Failed to send friend request.");
      } finally {
        setActiveFriendUserId(null);
      }
    },
    [loadFriendRows],
  );

  if (!isActive) {
    return null;
  }

  return (
    <section className="w-full border-b border-border px-3">
      <div className="mt-3 w-full">
        <button
          type="button"
          onClick={() => openFriendSearch()}
          className="w-full rounded-xl border border-border bg-bg px-3 py-2 text-left text-sm text-muted transition hover:border-muted hover:text-foreground"
        >
          Search to add or find friends...
        </button>
        <AnimatedModal
          isPresented={isFriendSearchPresented}
          isClosing={isFriendSearchClosing}
          onClose={() => closeFriendSearch()}
          ariaLabel="Search friends"
          hideHeader
          rootClassName="z-[2200] items-start px-3"
          panelClassName="h-full max-w-lg border-0 bg-transparent shadow-none"
          backdropClassName="bg-black/35 backdrop-blur-xl"
        >
          <div className="flex h-full min-h-0 flex-col pt-10">
            <UserSearch
              variant="panel"
              value={friendSearchQuery}
              onValueChange={setFriendSearchQuery}
              onSelect={onSelectUserFromSearch}
              searchUsers={searchFriendOptions}
              placeholder="Search to add or find friends..."
              autoFocus
              trailingAction={
                <IconButton
                  type="button"
                  variant="ghost"
                  aria-label="Close search"
                  onClick={() => closeFriendSearch()}
                >
                  <CloseIcon className="h-5 w-5" />
                </IconButton>
              }
              getOptionActionLabel={(option) => {
                if (option.friendshipStatus === "none" || option.friendshipStatus === "rejected") {
                  return "Request to Follow";
                }
                if (option.friendshipStatus === "pending_sent") {
                  return "Pending";
                }
                return null;
              }}
              isOptionActionDisabled={(option) =>
                activeFriendUserId === option.id ||
                (option.friendshipStatus !== "none" && option.friendshipStatus !== "rejected")
              }
              onOptionAction={onRequestFollowFromSearch}
            />
          </div>
        </AnimatedModal>
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
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{row.username}</p>
                  {row.email ? (
                    <p className="truncate text-xs text-muted">{row.email}</p>
                  ) : null}
                  <p className="mt-0.5 text-xs text-muted">Pending</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {statusMessage ? <p className="px-0 py-2 text-xs text-muted">{statusMessage}</p> : null}
    </section>
  );
}
