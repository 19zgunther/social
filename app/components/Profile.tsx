"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ChevronRight, CircleUserRound, Settings as SettingsIcon, Trash2 } from "lucide-react";
import UserProfileImage from "@/app/components/UserProfileImage";
import CachedImage from "@/app/components/utils/CachedImage";
import { PostSection } from "@/app/components/PostSection";
import UserSearch, { UserSearchOption } from "@/app/components/UserSearch";
import ProfilePictureEditor from "@/app/components/ProfilePictureEditor";
import {
  AcceptedFriend,
  ApiError,
  FriendRequestsListResponse,
  FriendSearchResponse,
  FriendSearchResult,
  IncomingFriendRequest,
  OutgoingFriendRequest,
  PostItem,
  ProfilePostsListResponse,
  UserProfileResponse,
} from "@/app/types/interfaces";
import { useStateCached } from "./useStateCached";

type ProfileProps = {
  userId: string;
  username: string;
  email: string | null;
  profileImageId: string | null;
  profileImageUrl: string | null;
  reloadSignal?: number;
  onProfileImageUpdated: (profileImageId: string | null, profileImageUrl: string | null) => void;
  onOpenSettings: () => void;
  onViewUserProfile: (userId: string) => void;
  onOpenCreatePost: () => void;
};


const postWithAuth = async (path: string, body: unknown): Promise<Response> => {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

function ProfilePictureRow({
  profileUserId,
  isCurrentUsers,
  localProfileImageUrl,
  localProfileImageId,
  username,
  email,
  onOpenSettings,
  setIsProfilePictureEditorOpen,
}: {
  profileUserId: string;
  isCurrentUsers: boolean;
  localProfileImageUrl: string | null;
  localProfileImageId: string | null;
  username: string;
  email: string | null;
  onOpenSettings: () => void;
  setIsProfilePictureEditorOpen: (isOpen: boolean) => void;
}) {
  return (
    <div className="border-b border-accent-1 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {isCurrentUsers ? (
            <button
              type="button"
              onClick={() => setIsProfilePictureEditorOpen(true)}
              className="cursor-pointer rounded-full"
              aria-label="Edit profile picture"
            >
              {localProfileImageUrl ? (
                <UserProfileImage
                  userId={profileUserId}
                  sizePx={64}
                  alt="Profile picture"
                  signedUrl={localProfileImageUrl}
                  imageId={localProfileImageId}
                />
              ) : (
                <div className="flex h-16 w-16 flex-col items-center justify-center rounded-full border border-accent-1 bg-secondary-background p-2 text-xs">
                  <CircleUserRound className="h-10 w-10 text-accent-2" />
                  <p className="text-accent-2">Click to add</p>
                </div>
              )}
            </button>
          ) : (
            <div>
              {localProfileImageUrl ? (
                <UserProfileImage
                  userId={profileUserId}
                  sizePx={64}
                  alt="Profile picture"
                  signedUrl={localProfileImageUrl}
                  imageId={localProfileImageId}
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-full border border-accent-1 bg-secondary-background p-2">
                  <CircleUserRound className="h-14 w-14 text-accent-2" />
                </div>
              )}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold text-foreground">{username}</p>
            {isCurrentUsers && <p className="truncate text-xs text-accent-2">{email ?? "No email"}</p>}
          </div>
        </div>

        {isCurrentUsers && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="rounded-full border border-accent-1 bg-secondary-background p-2 text-accent-2 transition hover:text-foreground"
            aria-label="Settings"
            title="Settings"
          >
            <SettingsIcon className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  )
}

function ProfilePostsSection({
  posts,
  isLoadingPosts,
  hasMorePosts,
  nextCursorPostId,
  isLoadingMorePosts,
  loadPosts,
  setSelectedPostId,
  onOpenCreatePost,
  showCreateButton = true,
}: {
  posts: PostItem[];
  isLoadingPosts: boolean;
  hasMorePosts: boolean;
  nextCursorPostId: string | null;
  isLoadingMorePosts: boolean;
  loadPosts: (cursorPostId?: string) => void;
  setSelectedPostId: (postId: string | null) => void;
  onOpenCreatePost?: () => void;
  showCreateButton?: boolean;
}) {
  return (
    <>
      <div className="border-b border-accent-1 px-3 py-3 flex items-center justify-between gap-3">
        <p>Posts</p>
        {showCreateButton && onOpenCreatePost ? (
          <button
            type="button"
            onClick={onOpenCreatePost}
            className="rounded-lg border border-accent-3 bg-secondary-background px-3 py-2 text-xs font-semibold text-accent-3 hover:text-foreground"
          >
            + Create Post
          </button>
        ) : null}
      </div>
      <div className="min-h-0">
        {isLoadingPosts ? <p className="px-3 py-3 text-xs text-accent-2">Loading posts...</p> : null}
        {!isLoadingPosts && posts.length === 0 ? (
          <p className="px-3 py-3 text-xs text-accent-2">
            {showCreateButton ? "No posts yet. Create your first post." : "No posts yet."}
          </p>
        ) : null}

        <div className="grid grid-cols-3 border-t border-accent-1">
          {posts.map((post, index) => {
            const showRightBorder = showCreateButton && onOpenCreatePost
              ? (index + 1) % 3 !== 0
              : index % 3 !== 2;
            const hasImageAttachment = Boolean(post.image_id);
            const hasSignedImageUrl = Boolean(post.image_url);
            const trimmedPostText = post.text.trim();
            return (
              <button
                key={post.id}
                type="button"
                onClick={() => setSelectedPostId(post.id)}
                className={`aspect-square bg-primary-background ${showRightBorder ? "border-r border-accent-1" : ""
                  } border-b border-accent-1`}
              >
                {hasSignedImageUrl ? (
                  <CachedImage
                    signedUrl={post.image_url}
                    imageId={post.image_id}
                    alt="Profile post"
                    className="h-full w-full object-cover"
                  />
                ) : hasImageAttachment ? (
                  <div className="flex h-full w-full items-center justify-center bg-black text-[10px] text-accent-2">
                    Loading...
                  </div>
                ) : (
                  <div className="flex h-full w-full items-start justify-start overflow-hidden bg-black p-1.5">
                    <p
                      className="w-full overflow-hidden text-left text-[9px] leading-tight text-foreground/80 break-words"
                      style={{
                        display: "-webkit-box",
                        WebkitLineClamp: 7,
                        WebkitBoxOrient: "vertical",
                      }}
                    >
                      {trimmedPostText || "(No text)"}
                    </p>
                  </div>
                )}
              </button>
            );
          })}
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
    </>
  )
}

function Profile({
  userId,
  username,
  email,
  profileImageId,
  profileImageUrl,
  reloadSignal = 0,
  onProfileImageUpdated,
  onOpenSettings,
  onViewUserProfile,
  onOpenCreatePost,
}: ProfileProps) {
  const [posts, setPosts] = useStateCached<PostItem[]>([], 'user_profile_posts_cache_v1');
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [isLoadingPosts, setIsLoadingPosts] = useState(true);
  const [hasMorePosts, setHasMorePosts] = useState(false);
  const [nextCursorPostId, setNextCursorPostId] = useState<string | null>(null);
  const [isLoadingMorePosts, setIsLoadingMorePosts] = useState(false);
  const [friendSearchQuery, setFriendSearchQuery] = useState("");
  const [friendSearchResults, setFriendSearchResults] = useState<FriendSearchResult[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<IncomingFriendRequest[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<OutgoingFriendRequest[]>([]);
  const [acceptedFriends, setAcceptedFriends] = useState<AcceptedFriend[]>([]);
  const [activeSubTab, setActiveSubTab] = useState<"posts" | "friends">("posts");
  const [isLoadingFriendRows, setIsLoadingFriendRows] = useState(true);
  const [activeFriendUserId, setActiveFriendUserId] = useState<string | null>(null);
  const [activeIncomingRequestId, setActiveIncomingRequestId] = useState<string | null>(null);
  const [removingFriendId, setRemovingFriendId] = useState<string | null>(null);
  const [confirmedDeleteFriendId, setConfirmedDeleteFriendId] = useState<string | null>(null);
  const [isProfilePictureEditorOpen, setIsProfilePictureEditorOpen] = useState(false);
  const [localProfileImageId, setLocalProfileImageId] = useState<string | null>(profileImageId);
  const [localProfileImageUrl, setLocalProfileImageUrl] = useState<string | null>(profileImageUrl);
  const [statusMessage, setStatusMessage] = useState("");
  const pendingOutgoingRequests = outgoingRequests.filter((row) => row.accepted === null);

  const selectedPost = selectedPostId ? posts.find((post) => post.id === selectedPostId) ?? null : null;

  useEffect(() => {
    setLocalProfileImageId(profileImageId);
  }, [profileImageId]);

  useEffect(() => {
    setLocalProfileImageUrl(profileImageUrl);
  }, [profileImageUrl]);

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

      const payload = (await response.json()) as ProfilePostsListResponse;
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
  }, [userId, reloadSignal]);

  const loadFriendRows = async () => {
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
  };

  useEffect(() => {
    void loadFriendRows();
  }, [userId]);

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

        const hint = friendshipStatus === "friends"
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
          profile_image_id: user.profile_image_id,
          profile_image_url: user.profile_image_url,
        };
      });
    },
    [runFriendSearch, userId],
  );

  const onSelectUserFromSearch = useCallback((option: UserSearchOption) => {
    setFriendSearchQuery(option.username);
    if (option.hint) {
      setStatusMessage(option.hint);
    }
    if (option.id !== userId) {
      onViewUserProfile(option.id);
    }
  }, [userId, onViewUserProfile]);

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

  const onRequestFollowFromSearch = useCallback(async (option: UserSearchOption): Promise<UserSearchOption | void> => {
    if (
      option.friendshipStatus === "self"
      || option.friendshipStatus === "friends"
      || option.friendshipStatus === "pending_sent"
      || option.friendshipStatus === "pending_received"
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
  }, []);

  const [confirmedDeletePost, setConfirmedDeletePost] = useState(false);
  useEffect(() => { setConfirmedDeletePost(false); }, [selectedPost]);

  const onDeleteSelectedPost = async () => {
    if (!selectedPost) {
      return;
    }
    if (!confirmedDeletePost) {
      setConfirmedDeletePost(true);
      return;
    }
    setConfirmedDeletePost(false);

    setStatusMessage("");
    try {
      const response = await postWithAuth("/api/post-delete", {
        post_id: selectedPost.id,
      });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }

      setPosts((previousPosts) =>
        previousPosts.filter((existingPost) => existingPost.id !== selectedPost.id),
      );
      setSelectedPostId(null);
      setStatusMessage("Post deleted.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to delete post.");
    }
  };

  if (selectedPost) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col bg-primary-background">
        <div className="flex items-center justify-between border-b border-accent-1 px-3 py-2">
          <button
            type="button"
            onClick={() => setSelectedPostId(null)}
            className="rounded-full flex gap-2 border border-accent-1 bg-secondary-background px-3 py-1 text-xs text-accent-2 hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <button
            type="button"
            onClick={() => { void onDeleteSelectedPost(); }}
            className="rounded-full flex gap-2 border border-accent-1 bg-secondary-background px-3 py-1 text-xs hover:text-foreground"
            style={{ color: confirmedDeletePost ? "red" : undefined }}
          >
            <Trash2 className="h-4 w-4" /> {confirmedDeletePost && "Confirm Delete"}
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y">
          <PostSection
            post={selectedPost}
            currentUserId={userId}
            showComments
            onPostUpdated={(updated) => {
              if (!selectedPost) {
                return;
              }
              setPosts((previousPosts) =>
                previousPosts.map((post) => {
                  if (post.id !== updated.id) {
                    return post;
                  }
                  return {
                    ...post,
                    ...(updated.data !== undefined ? { data: updated.data } : {}),
                    ...(updated.text !== undefined ? { text: updated.text } : {}),
                    ...(updated.like_count !== undefined ? { like_count: updated.like_count } : {}),
                    ...(updated.is_liked_by_viewer !== undefined
                      ? { is_liked_by_viewer: updated.is_liked_by_viewer }
                      : {}),
                  };
                }),
              );
            }}
          />
        </div>
        {statusMessage ? <p className="px-3 py-2 text-xs text-accent-2">{statusMessage}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain touch-pan-y bg-primary-background">
      <ProfilePictureEditor
        isOpen={isProfilePictureEditorOpen}
        onClose={() => setIsProfilePictureEditorOpen(false)}
        onSaved={(nextProfileImageId, nextProfileImageUrl) => {
          setLocalProfileImageId(nextProfileImageId);
          setLocalProfileImageUrl(nextProfileImageUrl);
          onProfileImageUpdated(nextProfileImageId, nextProfileImageUrl);
          setStatusMessage(nextProfileImageUrl ? "Profile image updated." : "Profile image removed.");
        }}
      />

      <ProfilePictureRow
        profileUserId={userId}
        isCurrentUsers={true}
        localProfileImageUrl={localProfileImageUrl}
        localProfileImageId={localProfileImageId}
        username={username}
        email={email}
        onOpenSettings={onOpenSettings}
        setIsProfilePictureEditorOpen={setIsProfilePictureEditorOpen}
      />

      <section className="border-b border-accent-1 px-3 py-2">
        <div className="flex items-center w-full">
          <button
            type="button"
            onClick={() => setActiveSubTab("posts")}
            className={`flex-1 border-b-2 px-3 py-2 text-sm font-semibold transition ${activeSubTab === "posts"
              ? "border-accent-3 text-foreground"
              : "border-transparent text-accent-2 hover:text-foreground"
              }`}
          >
            Posts
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab("friends")}
            className={`flex-1 border-b-2 px-3 py-2 text-sm font-semibold transition ${activeSubTab === "friends"
              ? "border-accent-3 text-foreground"
              : "border-transparent text-accent-2 hover:text-foreground"
              }`}
          >
            Friends
          </button>
        </div>
      </section>

      {activeSubTab === "friends" ? (
        <section className="border-b border-accent-1 px-3 py-3 w-full">
          <p className="text-xs font-semibold text-accent-2 mt-1">Search for users to add as friends</p>
          <div className="mt-3 w-full">
            <UserSearch
              value={friendSearchQuery}
              onValueChange={setFriendSearchQuery}
              onSelect={onSelectUserFromSearch}
              searchUsers={searchFriendOptions}
              placeholder="Search username/email"
              inputClassName="w-full rounded-lg border border-accent-1 bg-primary-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent-2"
              dropdownClassName="min-h-[30vh] max-h-[60vh]"
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
                activeFriendUserId === option.id
                || option.friendshipStatus !== "none"
                && option.friendshipStatus !== "rejected"
              }
              onOptionAction={onRequestFollowFromSearch}
            />
          </div>

          <div className="mt-5">
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

              <p className="mb-1 text-xs font-semibold text-accent-2">Your friends ({acceptedFriends.length})</p>
              <div className="space-y-2">
                {acceptedFriends.map((friend) => (
                  <button
                    key={friend.id}
                    type="button"
                    onClick={() => { onViewUserProfile(friend.user_id); }}
                    className="w-full rounded-lg border border-accent-1 bg-primary-background px-3 py-2 flex items-center gap-3 transition hover:bg-secondary-background"
                  >
                    <UserProfileImage
                      userId={friend.user_id}
                      sizePx={40}
                      alt={`${friend.username} profile`}
                      signedUrl={friend.profile_image_url}
                      imageId={friend.profile_image_id}
                    />
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-sm font-medium text-foreground truncate">{friend.username}</p>
                      {friend.email && (
                        <p className="text-xs text-accent-2 truncate">{friend.email}</p>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 text-accent-2 flex-shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {pendingOutgoingRequests.length > 0 ? (
            <div className="mt-3">
              <p className="mb-1 text-xs font-semibold text-accent-2">Pending sent requests</p>
              <div className="space-y-2">
                {pendingOutgoingRequests.map((row) => (
                  <div
                    key={row.id}
                    className="rounded-lg border border-accent-1 bg-primary-background px-3 py-2 flex items-center gap-3"
                  >
                    <UserProfileImage
                      userId={row.other_user_id}
                      sizePx={40}
                      alt={`${row.username} profile`}
                      signedUrl={row.profile_image_url}
                      imageId={row.profile_image_id}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{row.username}</p>
                      {row.email && (
                        <p className="text-xs text-accent-2 truncate">{row.email}</p>
                      )}
                      <p className="mt-0.5 text-xs text-accent-2">Pending</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : (
        <ProfilePostsSection
          posts={posts}
          isLoadingPosts={isLoadingPosts}
          hasMorePosts={hasMorePosts}
          nextCursorPostId={nextCursorPostId}
          isLoadingMorePosts={isLoadingMorePosts}
          loadPosts={loadPosts}
          setSelectedPostId={setSelectedPostId}
          onOpenCreatePost={onOpenCreatePost}
        />
      )}

      {statusMessage ? <p className="px-3 py-2 text-xs text-accent-2">{statusMessage}</p> : null}
    </div>
  );
}

function ProfileOtherUser({
  isActive,
  userId,
  currentUserId,
  onBack,
}: {
  isActive: boolean;
  userId: string;
  currentUserId: string;
  onBack: () => void;
}) {
  const [profileData, setProfileData] = useState<UserProfileResponse | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isLoadingMorePosts, setIsLoadingMorePosts] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [isSendingRequest, setIsSendingRequest] = useState(false);

  const [removeFriendConfirmed, setRemoveFriendConfirmed] = useState(false);
  const [isRemovingFriend, setIsRemovingFriend] = useState(false);

  const onRemoveFriend = async () => {
    if (!profileData || !profileData.friendship_id) {
      return;
    }

    if (!removeFriendConfirmed) {
      setRemoveFriendConfirmed(true);
      return;
    }

    setIsRemovingFriend(true);
    setStatusMessage("");
    try {
      const response = await postWithAuth("/api/friend-remove", {
        friend_id: profileData.friendship_id,
      });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }

      setRemoveFriendConfirmed(false);
      await loadProfile();
      setStatusMessage("Friend removed.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to remove friend.");
    } finally {
      setIsRemovingFriend(false);
    }
  };

  // Clear remove friend confirmation when the profile changes
  useEffect(() => {setRemoveFriendConfirmed(false)}, [userId, isActive, currentUserId])

  const selectedPost = selectedPostId && profileData
    ? profileData.posts.find((post) => post.id === selectedPostId) ?? null
    : null;

  const loadProfile = async (cursorPostId?: string) => {
    if (cursorPostId) {
      setIsLoadingMorePosts(true);
    } else {
      setIsLoadingProfile(true);
    }

    setStatusMessage("");
    try {
      const response = await postWithAuth("/api/user-profile", {
        user_id: userId,
        ...(cursorPostId ? { cursor_post_id: cursorPostId } : {}),
      });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }

      const payload = (await response.json()) as UserProfileResponse;
      setProfileData((previous) => {
        if (cursorPostId && previous) {
          return {
            ...payload,
            posts: [...previous.posts, ...payload.posts],
          };
        }
        return payload;
      });
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to load profile.");
    } finally {
      setIsLoadingProfile(false);
      setIsLoadingMorePosts(false);
    }
  };

  useEffect(() => {
    void loadProfile();
  }, [userId]);

  useEffect(() => {
    setRemoveFriendConfirmed(false);
  }, [profileData?.friendship_status]);

  const onSendFriendRequest = async () => {
    if (!profileData) {
      return;
    }

    setIsSendingRequest(true);
    setStatusMessage("");
    try {
      const response = await postWithAuth("/api/friend-request-create", {
        other_user_id: userId,
      });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }

      await loadProfile();
      setStatusMessage("Friend request sent.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to send friend request.");
    } finally {
      setIsSendingRequest(false);
    }
  };

  if (selectedPost) {
    return (
      <div
        className="flex h-full min-h-0 w-full flex-col bg-primary-background"
      >
        <div className="flex items-center justify-between border-b border-accent-1 px-3 py-2">
          <button
            type="button"
            onClick={() => setSelectedPostId(null)}
            className="rounded-full flex gap-2 border border-accent-1 bg-secondary-background px-3 py-1 text-xs text-accent-2 hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y">
          <PostSection
            post={selectedPost}
            currentUserId={currentUserId}
            showComments
            onPostUpdated={(updated) => {
              setProfileData((previous) => {
                if (!previous) {
                  return previous;
                }
                return {
                  ...previous,
                  posts: previous.posts.map((post) => {
                    if (post.id !== updated.id) {
                      return post;
                    }
                    return {
                      ...post,
                      ...(updated.data !== undefined ? { data: updated.data } : {}),
                      ...(updated.text !== undefined ? { text: updated.text } : {}),
                      ...(updated.like_count !== undefined ? { like_count: updated.like_count } : {}),
                      ...(updated.is_liked_by_viewer !== undefined
                        ? { is_liked_by_viewer: updated.is_liked_by_viewer }
                        : {}),
                    };
                  }),
                };
              });
            }}
          />
        </div>
        {statusMessage ? <p className="px-3 py-2 text-xs text-accent-2">{statusMessage}</p> : null}
      </div>
    );
  }

  if (isLoadingProfile || !profileData) {
    return (
      <div
        className="flex h-full min-h-0 flex-col bg-primary-background"
      >
        <div className="border-b border-accent-1 px-3 py-2">
          <button
            type="button"
            onClick={onBack}
            className="rounded-full flex gap-2 border border-accent-1 bg-secondary-background px-3 py-1 text-xs text-accent-2 hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-accent-2">
            {isLoadingProfile ? "Loading profile..." : statusMessage || "Profile not found."}
          </p>
        </div>
      </div>
    );
  }

  const isFriends = profileData.friendship_status === "friends";
  const canSendRequest = profileData.friendship_status === "none" || profileData.friendship_status === "rejected";

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain touch-pan-y bg-primary-background"
    >
      <div className="border-b border-accent-1 px-3 py-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-full flex gap-2 border border-accent-1 bg-secondary-background px-3 py-1 text-xs text-accent-2 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      </div>

      <ProfilePictureRow
        profileUserId={profileData.user.id}
        isCurrentUsers={false}
        localProfileImageUrl={profileData.user.profile_image_url}
        localProfileImageId={profileData.user.profile_image_id}
        username={profileData.user.username}
        email={null}
        onOpenSettings={() => { }}
        setIsProfilePictureEditorOpen={() => { }}
      />

      {!isFriends ? (
        <div className="border-b border-accent-1 px-4 py-6 flex flex-col items-center justify-center gap-3">
          {canSendRequest ? (
            <>
              <p className="text-sm text-accent-2 text-center">
                Send a friend request to view {profileData.user.username}'s posts.
              </p>
              <button
                type="button"
                onClick={() => { void onSendFriendRequest(); }}
                disabled={isSendingRequest}
                className="rounded-lg bg-accent-3 px-6 py-3 text-sm font-semibold text-primary-background transition hover:brightness-110 disabled:opacity-50"
              >
                {isSendingRequest ? "Sending..." : "Request To Follow"}
              </button>
            </>
          ) : profileData.friendship_status === "pending_sent" ? (
            <p className="text-sm text-accent-2 text-center">
              Friend request sent. Waiting for {profileData.user.username} to accept.
            </p>
          ) : profileData.friendship_status === "pending_received" ? (
            <p className="text-sm text-accent-2 text-center">
              {profileData.user.username} has sent you a friend request. Check your Profile tab to respond.
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <div className="border-b border-accent-1 px-4 py-3 flex items-center justify-center">
            <button
              type="button"
              onClick={() => { void onRemoveFriend(); }}
              disabled={isRemovingFriend}
              className="rounded-lg border border-red-500 px-4 py-2 text-xs font-medium text-accent-2 transition hover:text-foreground disabled:opacity-50"
              style={{ color: removeFriendConfirmed ? "red" : undefined }}
            >
              {isRemovingFriend ? "Removing..." : removeFriendConfirmed ? "Confirm Remove Friend" : "Remove Friend"}
            </button>
          </div>
          <ProfilePostsSection
            posts={profileData.posts}
            isLoadingPosts={false}
            hasMorePosts={profileData.has_more}
            nextCursorPostId={profileData.next_cursor_post_id}
            isLoadingMorePosts={isLoadingMorePosts}
            loadPosts={(cursorPostId) => { void loadProfile(cursorPostId); }}
            setSelectedPostId={setSelectedPostId}
            onOpenCreatePost={undefined}
            showCreateButton={false}
          />
        </>
      )}

      {statusMessage ? <p className="px-3 py-2 text-xs text-accent-2">{statusMessage}</p> : null}
    </div>
  );
}

export {
  Profile,
  ProfileOtherUser,
}