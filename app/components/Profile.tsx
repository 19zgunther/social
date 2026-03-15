"use client";

import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, CircleUserRound, LogOut, Plus } from "lucide-react";
import PostSection, { PostItem } from "@/app/components/PostSection";
import { prepareImageForUpload } from "@/app/components/client_file_storage_utils";
import UserSearch, { UserSearchOption } from "@/app/components/UserSearch";

type ProfileProps = {
  userId: string;
  username: string;
  email: string | null;
  onLogout: () => void;
};

type ApiError = {
  error?: {
    code?: string;
    message?: string;
  };
};

type FriendSearchResult = {
  id: string;
  username: string;
  email: string | null;
  relation: {
    id: string;
    direction: "outgoing" | "incoming";
    accepted: boolean | null;
  } | null;
};

type IncomingFriendRequest = {
  id: string;
  requesting_user_id: string;
  requested_at: string;
  username: string;
  email: string | null;
};

type OutgoingFriendRequest = {
  id: string;
  other_user_id: string;
  requested_at: string;
  accepted: boolean | null;
  accepted_at: string | null;
  username: string;
  email: string | null;
};

type AcceptedFriend = {
  id: string;
  user_id: string;
  username: string;
  email: string | null;
  accepted_at: string | null;
};

const AUTH_TOKEN_KEY = "auth_token";

const postWithAuth = async (path: string, body: unknown): Promise<Response> => {
  const token = window.localStorage.getItem(AUTH_TOKEN_KEY);
  if (!token) {
    throw new Error("Not authenticated.");
  }

  return fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
};

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as ApiError;
    return body.error?.message ?? "Request failed.";
  } catch {
    return "Request failed.";
  }
};

export default function Profile({ userId, username, email, onLogout }: ProfileProps) {
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [isLoadingPosts, setIsLoadingPosts] = useState(true);
  const [hasMorePosts, setHasMorePosts] = useState(false);
  const [nextCursorPostId, setNextCursorPostId] = useState<string | null>(null);
  const [isLoadingMorePosts, setIsLoadingMorePosts] = useState(false);
  const [createCaption, setCreateCaption] = useState("");
  const [createImagePreviewUrl, setCreateImagePreviewUrl] = useState<string | null>(null);
  const [createImageBase64Data, setCreateImageBase64Data] = useState<string | null>(null);
  const [createImageMimeType, setCreateImageMimeType] = useState<string | null>(null);
  const [isCreatingPost, setIsCreatingPost] = useState(false);
  const [friendSearchQuery, setFriendSearchQuery] = useState("");
  const [friendSearchResults, setFriendSearchResults] = useState<FriendSearchResult[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<IncomingFriendRequest[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<OutgoingFriendRequest[]>([]);
  const [acceptedFriends, setAcceptedFriends] = useState<AcceptedFriend[]>([]);
  const [isFriendsExpanded, setIsFriendsExpanded] = useState(false);
  const [isLoadingFriendRows, setIsLoadingFriendRows] = useState(true);
  const [activeFriendUserId, setActiveFriendUserId] = useState<string | null>(null);
  const [activeIncomingRequestId, setActiveIncomingRequestId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const createInputRef = useRef<HTMLInputElement | null>(null);
  const pendingOutgoingRequests = outgoingRequests.filter((row) => row.accepted === null);

  const selectedPost = selectedPostId ? posts.find((post) => post.id === selectedPostId) ?? null : null;

  const loadPosts = async (cursorPostId?: string) => {
    if (cursorPostId) {
      setIsLoadingMorePosts(true);
    } else {
      setIsLoadingPosts(true);
    }

    setStatusMessage("");
    try {
      const response = await postWithAuth("/api/profile-posts-list", {
        ...(cursorPostId ? { cursor_post_id: cursorPostId } : {}),
      });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }

      const payload = (await response.json()) as {
        posts: PostItem[];
        has_more: boolean;
        next_cursor_post_id: string | null;
      };
      setPosts((previousPosts) =>
        cursorPostId ? [...previousPosts, ...payload.posts] : payload.posts,
      );
      setHasMorePosts(payload.has_more);
      setNextCursorPostId(payload.next_cursor_post_id);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to load profile posts.");
    } finally {
      setIsLoadingPosts(false);
      setIsLoadingMorePosts(false);
    }
  };

  useEffect(() => {
    void loadPosts();
  }, [userId]);

  const loadFriendRows = async () => {
    setIsLoadingFriendRows(true);
    try {
      const response = await postWithAuth("/api/friend-requests-list", {});
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }

      const payload = (await response.json()) as {
        incoming_requests: IncomingFriendRequest[];
        outgoing_requests: OutgoingFriendRequest[];
        accepted_friends: AcceptedFriend[];
      };
      setIncomingRequests(payload.incoming_requests);
      setOutgoingRequests(payload.outgoing_requests);
      setAcceptedFriends(payload.accepted_friends);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to load friend requests.");
    } finally {
      setIsLoadingFriendRows(false);
    }
  };

  useEffect(() => {
    void loadFriendRows();
  }, [userId]);

  const runFriendSearch = useCallback(async (rawQuery: string): Promise<FriendSearchResult[]> => {
    const query = rawQuery.trim();
    if (!query) {
      setFriendSearchResults([]);
      return [];
    }

    try {
      const response = await postWithAuth("/api/friend-search", {
        query,
      });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return [];
      }

      const payload = (await response.json()) as { users: FriendSearchResult[] };
      setFriendSearchResults(payload.users);
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
        const hint = relation
          ? relation.accepted === true
            ? "Friends"
            : relation.accepted === false
              ? "Rejected"
              : relation.direction === "incoming"
                ? "Incoming request"
                : "Request sent"
          : undefined;

        return {
          id: user.id,
          username: user.username,
          email: user.email,
          hint,
        };
      });
    },
    [runFriendSearch],
  );

  const onSendFriendRequest = async (otherUserId: string) => {
    setActiveFriendUserId(otherUserId);
    setStatusMessage("");
    try {
      const response = await postWithAuth("/api/friend-request-create", {
        other_user_id: otherUserId,
      });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }

      await Promise.all([runFriendSearch(friendSearchQuery), loadFriendRows()]);
      setStatusMessage("Friend request sent.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to send friend request.");
    } finally {
      setActiveFriendUserId(null);
    }
  };

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

  const onSelectPostImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    try {
      const preparedImage = await prepareImageForUpload(file);
      setCreateImagePreviewUrl(preparedImage.previewDataUrl);
      setCreateImageBase64Data(preparedImage.base64Data);
      setCreateImageMimeType(preparedImage.mimeType);
      setStatusMessage("");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to prepare image.");
    }
  };

  const onCreatePost = async () => {
    if (!createImageBase64Data || !createImageMimeType) {
      return;
    }

    setIsCreatingPost(true);
    setStatusMessage("");
    try {
      const response = await postWithAuth("/api/post-create", {
        text: createCaption.trim(),
        image_base64_data: createImageBase64Data,
        image_mime_type: createImageMimeType,
      });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }

      const payload = (await response.json()) as { post: PostItem };
      setPosts((previousPosts) => [payload.post, ...previousPosts]);
      setCreateCaption("");
      setCreateImagePreviewUrl(null);
      setCreateImageBase64Data(null);
      setCreateImageMimeType(null);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to create post.");
    } finally {
      setIsCreatingPost(false);
    }
  };

  if (selectedPost) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col bg-primary-background">
        <div className="border-b border-accent-1 px-3 py-2">
          <button
            type="button"
            onClick={() => setSelectedPostId(null)}
            className="rounded-full border border-accent-1 bg-secondary-background px-3 py-1 text-xs text-accent-2 hover:text-foreground"
          >
            Back
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y">
          <PostSection post={selectedPost} showComments />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain touch-pan-y bg-primary-background">
      <div className="border-b border-accent-1 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
          <div className="rounded-full border border-accent-1 bg-secondary-background p-2">
            <CircleUserRound className="h-14 w-14 text-accent-2" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold text-foreground">{username}</p>
            <p className="truncate text-xs text-accent-2">{email ?? "No email"}</p>
          </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="rounded-full border border-accent-1 bg-secondary-background p-2 text-accent-2 transition hover:text-foreground"
            aria-label="Log out"
            title="Log out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/** Friends Section */}
      <section className="border-b border-accent-1 px-3 py-3">
        <button
          type="button"
          onClick={() => setIsFriendsExpanded((previous) => !previous)}
          className="flex w-full items-center gap-1 text-left text-sm font-semibold text-foreground"
        >
          {isFriendsExpanded ? (
            <ChevronDown className="h-4 w-4 text-accent-2" aria-hidden />
          ) : (
            <ChevronRight className="h-4 w-4 text-accent-2" aria-hidden />
          )}
          {isFriendsExpanded
            ? "Friends"
            : `Friends (${acceptedFriends.length}), Requests (${
                incomingRequests.length + pendingOutgoingRequests.length
              })`}
        </button>

        {isFriendsExpanded ? (
          <div className="mt-3 space-y-3">
            <div className="flex items-center gap-2">
              <UserSearch
                value={friendSearchQuery}
                onValueChange={setFriendSearchQuery}
                onSelect={(option) => {
                  setFriendSearchQuery(option.username);
                  if (option.hint) {
                    setStatusMessage(option.hint);
                  }
                }}
                searchUsers={searchFriendOptions}
                placeholder="Search username/email"
                inputClassName="w-full rounded-lg border border-accent-1 bg-primary-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent-2"
              />
            </div>

            {friendSearchResults.length > 0 ? (
              <div className="space-y-2">
                {friendSearchResults.map((result) => {
                  const relation = result.relation;
                  const canRequest = relation === null;
                  const relationLabel = relation
                    ? relation.accepted === true
                      ? "Friends"
                      : relation.accepted === false
                        ? "Rejected"
                        : relation.direction === "incoming"
                          ? "Incoming request"
                          : "Request sent"
                    : "";
                  return (
                    <div
                      key={result.id}
                      className="flex items-center justify-between rounded-lg border border-accent-1 bg-primary-background px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm text-foreground">{result.username}</p>
                        <p className="truncate text-xs text-accent-2">{result.email ?? "No email"}</p>
                        {relationLabel ? (
                          <p className="text-[11px] text-accent-2">{relationLabel}</p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          void onSendFriendRequest(result.id);
                        }}
                        disabled={!canRequest || activeFriendUserId === result.id}
                        className="rounded-lg border border-accent-1 px-2 py-1 text-xs text-accent-2 hover:text-foreground disabled:opacity-50"
                      >
                        {activeFriendUserId === result.id ? "..." : "Request"}
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <div>
              {isLoadingFriendRows ? (
                <p className="text-xs text-accent-2">Loading friends...</p>
              ) : null}

              {!isLoadingFriendRows && incomingRequests.length === 0 && acceptedFriends.length === 0 ? (
                <p className="text-xs text-accent-2">No friends or requests yet.</p>
              ) : null}

              <div className="space-y-2">
                {incomingRequests.map((requestRow) => (
                  <div
                    key={requestRow.id}
                    className="rounded-lg border border-accent-1 bg-primary-background px-3 py-2"
                  >
                    <p className="text-sm text-foreground">{requestRow.username}</p>
                    <p className="text-xs text-accent-2">{requestRow.email ?? "No email"}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          void onRespondToFriendRequest(requestRow.id, true);
                        }}
                        disabled={activeIncomingRequestId === requestRow.id}
                        className="rounded-lg bg-accent-3 px-2 py-1 text-xs font-semibold text-primary-background disabled:opacity-50"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void onRespondToFriendRequest(requestRow.id, false);
                        }}
                        disabled={activeIncomingRequestId === requestRow.id}
                        className="rounded-lg border border-accent-1 px-2 py-1 text-xs text-accent-2 hover:text-foreground disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}

                {acceptedFriends.map((friend) => (
                  <div
                    key={friend.id}
                    className="rounded-lg border border-accent-1 bg-primary-background px-3 py-2"
                  >
                    <p className="text-sm text-foreground">{friend.username}</p>
                    <p className="text-xs text-accent-2">{friend.email ?? "No email"}</p>
                  </div>
                ))}
              </div>
            </div>

            {pendingOutgoingRequests.length > 0 ? (
              <div>
                <p className="mb-1 text-xs font-semibold text-accent-2">Pending sent requests</p>
                <div className="space-y-2">
                  {pendingOutgoingRequests.map((row) => (
                    <div
                      key={row.id}
                      className="rounded-lg border border-accent-1 bg-primary-background px-3 py-2"
                    >
                      <p className="text-sm text-foreground">{row.username}</p>
                      <p className="text-xs text-accent-2">{row.email ?? "No email"}</p>
                      <p className="mt-1 text-[11px] text-accent-2">Pending</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {/** Create Post Section */}
      {createImagePreviewUrl ? (
        <div className="border-b border-accent-1 bg-secondary-background p-3">
          <div className="relative aspect-square overflow-hidden rounded-lg border border-accent-1">
            <img
              src={createImagePreviewUrl}
              alt="New post preview"
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-x-0 bottom-0 bg-black/55 p-2 backdrop-blur-[1px]">
              <input
                value={createCaption}
                onChange={(event) => setCreateCaption(event.target.value)}
                placeholder="Caption (optional)"
                className="w-full rounded-lg border border-white/30 bg-black/45 px-3 py-2 text-sm text-white outline-none placeholder:text-white/70 focus:border-white/70"
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={onCreatePost}
                  disabled={isCreatingPost}
                  className="rounded-lg bg-accent-3 px-3 py-2 text-xs font-semibold text-primary-background transition hover:brightness-110 disabled:opacity-50"
                >
                  {isCreatingPost ? "Posting..." : "Post"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreateImagePreviewUrl(null);
                    setCreateImageBase64Data(null);
                    setCreateImageMimeType(null);
                    setCreateCaption("");
                  }}
                  className="rounded-lg border border-white/30 bg-black/45 px-3 py-2 text-xs text-white hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <input
        ref={createInputRef}
        type="file"
        accept="image/*"
        onChange={onSelectPostImage}
        className="hidden"
      />

      <div className="border-b border-accent-1 px-3 py-3">
        Posts
      </div>
      <div className="min-h-0">
        {isLoadingPosts ? <p className="px-3 py-3 text-xs text-accent-2">Loading posts...</p> : null}
        {!isLoadingPosts && posts.length === 0 ? (
          <p className="px-3 py-3 text-xs text-accent-2">No posts yet. Create your first post.</p>
        ) : null}

        <div className="grid grid-cols-3 border-t border-accent-1">
          <button
            type="button"
            onClick={() => createInputRef.current?.click()}
            className="aspect-square border-r border-b border-accent-1 bg-secondary-background p-2"
          >
            <div className="flex h-full w-full items-center justify-center rounded-md border border-accent-1">
              <Plus className="h-6 w-6 text-accent-2" />
            </div>
          </button>

          {posts.map((post, index) => (
            <button
              key={post.id}
              type="button"
              onClick={() => setSelectedPostId(post.id)}
              className={`aspect-square bg-primary-background ${
                index % 3 !== 2 ? "border-r border-accent-1" : ""
              } border-b border-accent-1`}
            >
              {post.image_url ? (
                <img src={post.image_url} alt="Profile post" className="h-full w-full object-cover" />
              ) : null}
            </button>
          ))}
        </div>

        {hasMorePosts ? (
          <div className="px-3 py-3">
            <button
              type="button"
              onClick={() => {
                if (nextCursorPostId && !isLoadingMorePosts) {
                  void loadPosts(nextCursorPostId);
                }
              }}
              disabled={!nextCursorPostId || isLoadingMorePosts}
              className="w-full rounded-lg border border-accent-1 bg-secondary-background px-3 py-2 text-xs font-medium text-accent-2 transition hover:text-foreground disabled:opacity-50"
            >
              {isLoadingMorePosts ? "Loading..." : "Load more"}
            </button>
          </div>
        ) : null}
      </div>

      {statusMessage ? <p className="px-3 py-2 text-xs text-accent-2">{statusMessage}</p> : null}
    </div>
  );
}
