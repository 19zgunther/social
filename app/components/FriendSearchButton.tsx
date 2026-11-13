"use client";

import { useCallback, useState } from "react";
import { CloseIcon } from "@/app/components/Icons";
import AnimatedModal, { useAnimatedModal } from "@/app/components/utils/AnimatedModal";
import UserSearch, { UserSearchOption } from "@/app/components/UserSearch";
import { IconButton } from "@/app/ui-components";
import { cancelFriendRequest } from "@/app/lib/cancelFriendRequest";
import {
  ApiError,
  FriendSearchResponse,
  FriendSearchResult,
} from "@/app/types/interfaces";

type FriendSearchButtonProps = {
  userId: string;
  onViewUserProfile: (userId: string) => void;
  onFriendRequestSent?: () => void;
  onStatusMessage?: (message: string) => void;
  className?: string;
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

export default function FriendSearchButton({
  userId,
  onViewUserProfile,
  onFriendRequestSent,
  onStatusMessage,
  className,
}: FriendSearchButtonProps) {
  const [friendSearchQuery, setFriendSearchQuery] = useState("");
  const [activeFriendUserId, setActiveFriendUserId] = useState<string | null>(null);
  const {
    isPresented: isFriendSearchPresented,
    isClosing: isFriendSearchClosing,
    open: openFriendSearch,
    close: closeFriendSearch,
  } = useAnimatedModal();

  const runFriendSearch = useCallback(async (rawQuery: string): Promise<FriendSearchResult[]> => {
    const query = rawQuery.trim();

    try {
      const response = await postWithAuth("/api/friend-search", {
        query: query || undefined,
      });
      if (!response.ok) {
        onStatusMessage?.(await readErrorMessage(response));
        return [];
      }

      const payload = (await response.json()) as FriendSearchResponse;
      return payload.users;
    } catch (error) {
      onStatusMessage?.(error instanceof Error ? error.message : "Failed to search users.");
      return [];
    }
  }, [onStatusMessage]);

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
          friendshipId: relation?.id ?? null,
        };
      });
    },
    [runFriendSearch, userId],
  );

  const onSelectUserFromSearch = useCallback(
    (option: UserSearchOption) => {
      setFriendSearchQuery(option.username);
      if (option.hint) {
        onStatusMessage?.(option.hint);
      }
      closeFriendSearch();
      if (option.id !== userId) {
        onViewUserProfile(option.id);
      }
    },
    [userId, onViewUserProfile, closeFriendSearch, onStatusMessage],
  );

  const onRequestFollowFromSearch = useCallback(
    async (option: UserSearchOption): Promise<UserSearchOption | void> => {
      if (
        option.friendshipStatus === "self" ||
        option.friendshipStatus === "friends" ||
        option.friendshipStatus === "pending_received"
      ) {
        return option;
      }

      setActiveFriendUserId(option.id);
      onStatusMessage?.("");
      try {
        if (option.friendshipStatus === "pending_sent") {
          if (!option.friendshipId) {
            onStatusMessage?.("Friend request not found.");
            return option;
          }

          const cancelResult = await cancelFriendRequest({ friendId: option.friendshipId });
          onStatusMessage?.(cancelResult.message);
          if (!cancelResult.ok) {
            return;
          }

          onFriendRequestSent?.();
          if (!cancelResult.cancelled) {
            return {
              ...option,
              hint: "Friends",
              friendshipStatus: "friends",
            };
          }

          return {
            ...option,
            hint: "Not friends",
            friendshipStatus: "none",
            friendshipId: null,
          };
        }

        const response = await postWithAuth("/api/friend-request-create", {
          other_user_id: option.id,
        });
        if (!response.ok) {
          onStatusMessage?.(await readErrorMessage(response));
          return;
        }

        const payload = (await response.json()) as { friend?: { id?: string } };
        onFriendRequestSent?.();
        onStatusMessage?.("Friend request sent.");
        return {
          ...option,
          hint: "Pending request",
          friendshipStatus: "pending_sent",
          friendshipId: payload.friend?.id ?? null,
        };
      } catch (error) {
        onStatusMessage?.(
          error instanceof Error ? error.message : "Failed to send friend request.",
        );
      } finally {
        setActiveFriendUserId(null);
      }
    },
    [onFriendRequestSent, onStatusMessage],
  );

  return (
    <div className={className ?? "w-full"}>
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
                return "Cancel";
              }
              return null;
            }}
            isOptionActionDisabled={(option) =>
              activeFriendUserId === option.id ||
              (option.friendshipStatus !== "none" &&
                option.friendshipStatus !== "rejected" &&
                option.friendshipStatus !== "pending_sent")
            }
            onOptionAction={onRequestFollowFromSearch}
          />
        </div>
      </AnimatedModal>
    </div>
  );
}
