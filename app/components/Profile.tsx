"use client";

import { useCallback, useEffect, useState, type MutableRefObject, type ReactNode } from "react";
import {
  BotIcon,
  CheckIcon,
  MessageIcon,
  PlayIcon,
  SettingsIcon,
  DeleteIcon,
  PollIcon,
  TierListIcon,
} from "@/app/components/Icons";
import UserProfileImage from "@/app/components/UserProfileImage";
import CachedImage from "@/app/components/utils/CachedImage";
import BackButton from "@/app/components/utils/BackButton";
import CreatePostButton from "@/app/components/CreatePostButton";
import { Button, IconButton } from "@/app/ui-components";
import { PostSection } from "@/app/components/PostSection";
import PostOptionsPane from "@/app/components/PostOptionsPane";
import ProfileFriendsTab from "@/app/components/ProfileFriendsTab";
import ProfilePictureEditor from "@/app/components/ProfilePictureEditor";
import EditBot from "@/app/components/bots/EditBot";
import EmojiEditorTab from "@/app/components/EmojiEditorTab";
import PostGroupsTab from "@/app/components/PostGroupsTab";
import GamesTab from "@/app/components/games/GamesTab";
import { getPollViewerState } from "@/app/components/PollBlock";
import { getTierListViewerState } from "@/app/components/TierListBlock";
import { getPostCoverObject } from "@/app/lib/postMedia";
import {
  AcceptedFriend,
  ApiError,
  PostItem,
  ProfilePostsListResponse,
  ThreadItem,
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
  swipeBackOverrideRef: MutableRefObject<(() => void) | null>;
};

const PROFILE_SUB_TABS = [
  { id: "posts", label: "Posts" },
  { id: "friends", label: "Friends" },
  { id: "groups", label: "Groups" },
  { id: "emojis", label: "Emojis" },
  { id: "games", label: "Games" },
] as const;

type ProfileSubTab = (typeof PROFILE_SUB_TABS)[number]["id"];


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
  localProfileImageAccessGrant,
  localProfileImageId,
  username,
  email,
  isBot = false,
  onOpenSettings,
  setIsProfilePictureEditorOpen,
  trailingAction,
}: {
  profileUserId: string;
  isCurrentUsers: boolean;
  localProfileImageUrl: string | null;
  localProfileImageAccessGrant?: string | null;
  localProfileImageId: string | null;
  username: string;
  email: string | null;
  isBot?: boolean;
  onOpenSettings: () => void;
  setIsProfilePictureEditorOpen: (isOpen: boolean) => void;
  trailingAction?: ReactNode;
}) {
  const showProfilePhoto = Boolean(
    localProfileImageUrl || (localProfileImageAccessGrant && localProfileImageId),
  );
  return (
    <div className="border-none border-border px-4 py-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
          {isCurrentUsers ? (
            <button
              type="button"
              onClick={() => setIsProfilePictureEditorOpen(true)}
              className="shrink-0 cursor-pointer rounded-full"
              aria-label="Edit profile picture"
            >
              <UserProfileImage
                userId={profileUserId}
                sizePx={64}
                alt="Profile picture"
                username={username}
                signedUrl={showProfilePhoto ? localProfileImageUrl : null}
                imageAccessGrant={showProfilePhoto ? (localProfileImageAccessGrant ?? null) : null}
                imageStorageUserId={profileUserId}
                imageId={showProfilePhoto ? localProfileImageId : null}
              />
            </button>
          ) : (
            <div className="shrink-0">
              <UserProfileImage
                userId={profileUserId}
                sizePx={64}
                alt="Profile picture"
                username={username}
                signedUrl={showProfilePhoto ? localProfileImageUrl : null}
                imageAccessGrant={showProfilePhoto ? (localProfileImageAccessGrant ?? null) : null}
                imageStorageUserId={profileUserId}
                imageId={showProfilePhoto ? localProfileImageId : null}
              />
            </div>
          )}
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="flex min-w-0 items-center gap-1.5">
              <p className="min-w-0 truncate text-lg font-semibold text-foreground" title={username}>
                {username}
              </p>
              {isBot ? (
                <span
                  className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-muted"
                  title="Bot account"
                >
                  <BotIcon className="h-4 w-4" aria-hidden />
                  Bot
                </span>
              ) : null}
            </div>
            {isCurrentUsers && <p className="truncate text-xs text-muted">{email ?? "No email"}</p>}
          </div>
        </div>

        {isCurrentUsers ? (
          <button
            type="button"
            onClick={onOpenSettings}
            className="shrink-0 rounded-full p-2 text-muted"
            aria-label="Settings"
            title="Settings"
          >
            <SettingsIcon className="h-5 w-5" />
          </button>
        ) : trailingAction ? (
          <div className="shrink-0">{trailingAction}</div>
        ) : null}
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
    <div className="relative min-h-0">
      {showCreateButton && onOpenCreatePost ? (
        <button
          type="button"
          onClick={onOpenCreatePost}
          aria-label="Create post"
          className="create-post-rgb-border absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full transition hover:opacity-90"
          style={{ boxShadow: "0 4px 10px 4px black" }}
        >
          <span className="create-post-rgb-text text-2xl font-semibold leading-none" aria-hidden>
            +
          </span>
        </button>
      ) : null}

      {isLoadingPosts ? <p className="px-3 py-3 text-xs text-muted">Loading posts...</p> : null}
      {!isLoadingPosts && posts.length === 0 ? (
        showCreateButton && onOpenCreatePost ? (
          <div className="flex flex-col items-center gap-4 px-3 py-6">
            <p className="max-w-sm text-center text-lg font-semibold leading-snug text-foreground">
              Create your first post to show your friends what you're up to
            </p>
            <CreatePostButton onClick={onOpenCreatePost} />
          </div>
        ) : (
          <p className="px-3 py-3 text-xs text-muted">No posts yet.</p>
        )
      ) : null}

      <div className="grid grid-cols-3">
        {posts.map((post) => {
          const cover = getPostCoverObject(post.data);
          const coverImageId = post.cover_image_id ?? cover?.objectId ?? null;
          const coverGrant = post.cover_image_access_grant ?? null;
          const coverStorageUserId = cover?.ownerUserId ?? post.created_by;
          const hasImageAttachment = Boolean(coverImageId);
          const hasPostImageSource = Boolean(coverImageId && coverGrant);
          const trimmedPostText = post.text.trim();
          const poll = getPollViewerState(post.data);
          const tierList = getTierListViewerState(post.data);
          const firstMedia = post.data?.media?.[0];
          const isVideoFirst = firstMedia?.kind === "video";
          return (
            <button
              key={post.id}
              type="button"
              onClick={() => setSelectedPostId(post.id)}
              className={`relative rounded-lg p-0.25 aspect-square min-h-0 overflow-hidden bg-bg`}
            >
              {hasPostImageSource && coverImageId ? (
                <>
                <CachedImage
                  imageAccessGrant={coverGrant}
                  imageStorageUserId={coverStorageUserId}
                  imageId={coverImageId}
                  alt="Profile post"
                  className="pointer-events-none h-full w-full object-cover"
                />
                {isVideoFirst ? (
                  <span className="pointer-events-none absolute right-1.5 top-1.5 rounded-full bg-black/55 p-1 text-white">
                    <PlayIcon className="h-3 w-3 fill-white" />
                  </span>
                ) : null}
                </>
              ) : hasImageAttachment ? (
                <div className="flex h-full w-full items-center justify-center bg-black text-[10px] text-muted">
                  Loading...
                </div>
              ) : poll ? (
                <div className="flex h-full w-full flex-col items-start justify-start gap-1 overflow-hidden bg-black p-1.5">
                  <PollIcon className="h-4 w-4 shrink-0 text-accent" />
                  <p
                    className="w-full overflow-hidden text-left text-[9px] leading-tight text-foreground/80 break-words"
                    style={{
                      display: "-webkit-box",
                      WebkitLineClamp: 5,
                      WebkitBoxOrient: "vertical",
                    }}
                  >
                    {trimmedPostText || poll.options[0]?.text || "Poll"}
                  </p>
                </div>
              ) : tierList ? (
                <div className="flex h-full w-full flex-col items-start justify-start gap-1 overflow-hidden bg-black p-1.5">
                  <TierListIcon className="h-4 w-4 shrink-0 text-accent" />
                  <p
                    className="w-full overflow-hidden text-left text-[9px] leading-tight text-foreground/80 break-words"
                    style={{
                      display: "-webkit-box",
                      WebkitLineClamp: 5,
                      WebkitBoxOrient: "vertical",
                    }}
                  >
                    {trimmedPostText || tierList.options[0]?.text || "Tier list"}
                  </p>
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
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-full"
            onClick={() => {
              if (nextCursorPostId && !isLoadingMorePosts) {
                void loadPosts(nextCursorPostId);
              }
            }}
            disabled={!nextCursorPostId || isLoadingMorePosts}
          >
            {isLoadingMorePosts ? "Loading..." : "Load more"}
          </Button>
        </div>
      ) : null}
    </div>
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
  swipeBackOverrideRef,
}: ProfileProps) {
  const [posts, setPosts] = useStateCached<PostItem[]>([], "user_profile_posts_cache_v3");
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [isLoadingPosts, setIsLoadingPosts] = useState(true);
  const [hasMorePosts, setHasMorePosts] = useState(false);
  const [nextCursorPostId, setNextCursorPostId] = useState<string | null>(null);
  const [isLoadingMorePosts, setIsLoadingMorePosts] = useState(false);
  const [acceptedFriends, setAcceptedFriends] = useState<AcceptedFriend[]>([]);
  const [activeSubTab, setActiveSubTab] = useState<ProfileSubTab>("posts");
  const activeSubTabIndex = PROFILE_SUB_TABS.findIndex((tab) => tab.id === activeSubTab);
  const [isLoadingFriendRows, setIsLoadingFriendRows] = useState(true);
  const [isProfilePictureEditorOpen, setIsProfilePictureEditorOpen] = useState(false);
  const [localProfileImageId, setLocalProfileImageId] = useState<string | null>(profileImageId);
  const [localProfileImageUrl, setLocalProfileImageUrl] = useState<string | null>(profileImageUrl);
  const [statusMessage, setStatusMessage] = useState("");

  const onAcceptedFriendsChange = useCallback(
    (friends: AcceptedFriend[], isLoading: boolean) => {
      setAcceptedFriends(friends);
      setIsLoadingFriendRows(isLoading);
    },
    [],
  );

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

  const [confirmedDeletePost, setConfirmedDeletePost] = useState(false);
  const [showSelectedPostOptions, setShowSelectedPostOptions] = useState(false);
  useEffect(() => { setConfirmedDeletePost(false); }, [selectedPost]);
  useEffect(() => { setShowSelectedPostOptions(false); }, [selectedPost]);

  const onCloseSelectedPostOptions = useCallback(() => {
    setShowSelectedPostOptions(false);
  }, []);

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
      <div className="flex h-full min-h-0 w-full flex-col bg-bg">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <BackButton onBack={() => setSelectedPostId(null)} />
          <button
            type="button"
            onClick={() => { void onDeleteSelectedPost(); }}
            className="rounded-full flex gap-2 px-3 py-1 text-xs hover:text-foreground"
            style={{ color: confirmedDeletePost ? "red" : undefined }}
          >
            <DeleteIcon className="h-4 w-4" /> {confirmedDeletePost && "Confirm Delete"}
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y">
          <PostSection
            post={selectedPost}
            currentUserId={userId}
            showComments
            onOpenPostOptions={() => setShowSelectedPostOptions(true)}
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
        {statusMessage ? <p className="px-3 py-2 text-xs text-muted">{statusMessage}</p> : null}
        {showSelectedPostOptions ? (
          <PostOptionsPane
            post={selectedPost}
            onBack={onCloseSelectedPostOptions}
            currentUserId={userId}
            onViewUserProfile={onViewUserProfile}
            swipeBackOverrideRef={swipeBackOverrideRef}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain touch-pan-y bg-bg">
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

      <section className="border-none border-border px-3 py-2.5">
        <div
          role="tablist"
          aria-label="Profile sections"
          className="relative flex w-full rounded-full bg-surface border-border border-2 p-1"
        >
          <div
            aria-hidden
            className="absolute inset-y-1 left-1 rounded-full bg-accent transition-transform duration-200 ease-out"
            style={{
              width: `calc((100% - 0.5rem) / ${PROFILE_SUB_TABS.length})`,
              transform: `translateX(${Math.max(activeSubTabIndex, 0) * 100}%)`,
            }}
          />
          {PROFILE_SUB_TABS.map((tab) => {
            const isActive = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveSubTab(tab.id)}
                className={`relative z-10 flex flex-1 items-center justify-center gap-1 rounded-full px-1 py-2.5 text-xs font-semibold transition-colors ${
                  isActive ? "text-on-accent" : "text-muted hover:text-foreground"
                }`}
              >
                {isActive ? <CheckIcon aria-hidden className="h-3 w-3 shrink-0" strokeWidth={2.75} /> : null}
                <span className="truncate">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      <ProfileFriendsTab
        userId={userId}
        isActive={activeSubTab === "friends"}
        onViewUserProfile={onViewUserProfile}
        onAcceptedFriendsChange={onAcceptedFriendsChange}
      />

      {activeSubTab === "groups" ? (
        <PostGroupsTab
          isActive={activeSubTab === "groups"}
          acceptedFriends={acceptedFriends}
          isLoadingFriends={isLoadingFriendRows}
          onGoToFriendsTab={() => setActiveSubTab("friends")}
        />
      ) : activeSubTab === "emojis" ? (
        <EmojiEditorTab isActive={activeSubTab === "emojis"} />
      ) : activeSubTab === "games" ? (
        <GamesTab isActive={activeSubTab === "games"} />
      ) : activeSubTab === "posts" ? (
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
      ) : null}

      {statusMessage ? <p className="px-3 py-2 text-xs text-muted">{statusMessage}</p> : null}
    </div>
  );
}

function ProfileOtherUser({
  isActive,
  userId,
  currentUserId,
  onBack,
  onOpenDirectThread,
  onViewUserProfile,
  swipeBackOverrideRef,
}: {
  isActive: boolean;
  userId: string;
  currentUserId: string;
  onBack: () => void;
  onOpenDirectThread: (thread: ThreadItem) => void;
  onViewUserProfile?: (userId: string) => void;
  swipeBackOverrideRef: MutableRefObject<(() => void) | null>;
}) {
  const [profileData, setProfileData] = useState<UserProfileResponse | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isLoadingMorePosts, setIsLoadingMorePosts] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [showSelectedPostOptions, setShowSelectedPostOptions] = useState(false);
  const [isSendingRequest, setIsSendingRequest] = useState(false);
  const [isOpeningDirectThread, setIsOpeningDirectThread] = useState(false);
  const [isBotSettingsOpen, setIsBotSettingsOpen] = useState(false);
  const [confirmedDeletePost, setConfirmedDeletePost] = useState(false);

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
  useEffect(() => {
    setRemoveFriendConfirmed(false);
    setIsBotSettingsOpen(false);
    setConfirmedDeletePost(false);
  }, [userId, isActive, currentUserId]);
  useEffect(() => { setShowSelectedPostOptions(false); }, [selectedPostId]);
  useEffect(() => { setConfirmedDeletePost(false); }, [selectedPostId]);

  const selectedPost = selectedPostId && profileData
    ? profileData.posts.find((post) => post.id === selectedPostId) ?? null
    : null;

  const onCloseSelectedPostOptions = useCallback(() => {
    setShowSelectedPostOptions(false);
  }, []);

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

  const onCloseBotSettings = () => {
    setIsBotSettingsOpen(false);
    void loadProfile();
  };

  const onDeleteSelectedPost = async () => {
    if (!selectedPost || !selectedPost.viewer_can_delete) {
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

      setProfileData((previous) => {
        if (!previous) {
          return previous;
        }
        return {
          ...previous,
          posts: previous.posts.filter((post) => post.id !== selectedPost.id),
        };
      });
      setSelectedPostId(null);
      setStatusMessage("Post deleted.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to delete post.");
    }
  };

  const onOpenMessage = async () => {
    setIsOpeningDirectThread(true);
    setStatusMessage("");
    try {
      const response = await postWithAuth("/api/thread-direct-open", {
        other_user_id: userId,
      });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }
      const payload = (await response.json()) as { thread: ThreadItem };
      onOpenDirectThread(payload.thread);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not open message thread.");
    } finally {
      setIsOpeningDirectThread(false);
    }
  };

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

      const wasPublicBot = Boolean(profileData.bot) && !profileData.bot?.is_private;
      await loadProfile();
      setStatusMessage(wasPublicBot ? "Following this bot." : "Friend request sent.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to send friend request.");
    } finally {
      setIsSendingRequest(false);
    }
  };

  if (isBotSettingsOpen && profileData?.bot?.bot_id) {
    return (
      <EditBot
        botId={profileData.bot.bot_id}
        onBack={onCloseBotSettings}
        swipeBackOverrideRef={swipeBackOverrideRef}
      />
    );
  }

  if (selectedPost) {
    return (
      <div
        className="flex h-full min-h-0 w-full flex-col bg-bg"
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <BackButton onBack={() => setSelectedPostId(null)} />
          {selectedPost.viewer_can_delete ? (
            <button
              type="button"
              onClick={() => {
                void onDeleteSelectedPost();
              }}
              className="rounded-full flex gap-2 px-3 py-1 text-xs hover:text-foreground"
              style={{ color: confirmedDeletePost ? "red" : undefined }}
            >
              <DeleteIcon className="h-4 w-4" /> {confirmedDeletePost && "Confirm Delete"}
            </button>
          ) : null}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y">
          <PostSection
            post={selectedPost}
            currentUserId={currentUserId}
            showComments
            onOpenPostOptions={() => setShowSelectedPostOptions(true)}
            onViewUserProfile={onViewUserProfile}
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
        {statusMessage ? <p className="px-3 py-2 text-xs text-muted">{statusMessage}</p> : null}
        {showSelectedPostOptions ? (
          <PostOptionsPane
            post={selectedPost}
            onBack={onCloseSelectedPostOptions}
            currentUserId={currentUserId}
            onViewUserProfile={onViewUserProfile}
            swipeBackOverrideRef={swipeBackOverrideRef}
          />
        ) : null}
      </div>
    );
  }

  if (isLoadingProfile || !profileData) {
    return (
      <div
        className="flex h-full min-h-0 flex-col bg-bg"
      >
        <div className="border-b border-border px-3 py-2">
          <BackButton onBack={onBack} />
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-muted">
            {isLoadingProfile ? "Loading profile..." : statusMessage || "Profile not found."}
          </p>
        </div>
      </div>
    );
  }

  const isFriends = profileData.friendship_status === "friends";
  const canSendRequest = profileData.friendship_status === "none" || profileData.friendship_status === "rejected";
  const botInfo = profileData.bot ?? null;

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain touch-pan-y bg-bg"
    >
      <div className="border-b border-border px-3 py-2">
        <BackButton onBack={onBack} />
      </div>

      <ProfilePictureRow
        profileUserId={profileData.user.id}
        isCurrentUsers={false}
        localProfileImageUrl={profileData.user.profile_image_url}
        localProfileImageAccessGrant={profileData.user.profile_image_access_grant ?? null}
        localProfileImageId={profileData.user.profile_image_id}
        username={profileData.user.username}
        email={null}
        isBot={Boolean(botInfo)}
        onOpenSettings={() => { }}
        setIsProfilePictureEditorOpen={() => { }}
        trailingAction={
          <div className="flex shrink-0 items-center gap-2">
            {botInfo && (!botInfo.is_private || botInfo.is_owner) ? (
              <IconButton
                type="button"
                variant="bordered"
                onClick={() => setIsBotSettingsOpen(true)}
                aria-label={botInfo.is_owner ? "Bot settings" : "View bot settings"}
                title={botInfo.is_owner ? "Bot settings" : "View bot settings"}
              >
                <SettingsIcon className="h-5 w-5" />
              </IconButton>
            ) : null}
            {isFriends ? (
              <>
                <IconButton
                  type="button"
                  variant="bordered"
                  onClick={() => { void onOpenMessage(); }}
                  disabled={isOpeningDirectThread}
                  aria-label={isOpeningDirectThread ? "Opening messages" : "Message"}
                  title={isOpeningDirectThread ? "Opening..." : "Message"}
                >
                  <MessageIcon className="h-5 w-5" />
                </IconButton>
                <IconButton
                  type="button"
                  variant={removeFriendConfirmed ? "danger" : "bordered"}
                  onClick={() => { void onRemoveFriend(); }}
                  disabled={isRemovingFriend}
                  aria-label={
                    isRemovingFriend
                      ? "Removing friend"
                      : removeFriendConfirmed
                        ? "Confirm remove friend"
                        : "Remove friend"
                  }
                  title={
                    isRemovingFriend
                      ? "Removing..."
                      : removeFriendConfirmed
                        ? "Tap again to confirm"
                        : "Remove friend"
                  }
                >
                  <DeleteIcon className="h-5 w-5" />
                </IconButton>
              </>
            ) : null}
          </div>
        }
      />

      {botInfo ? (
        <div className="border-b border-border px-4 py-3 space-y-2">
          <p className="text-xs text-muted">
            Created by{" "}
            <button
              type="button"
              onClick={() => onViewUserProfile?.(botInfo.owner_user_id)}
              className="font-medium text-foreground hover:underline"
            >
              @{botInfo.owner_username}
            </button>
          </p>
          {botInfo.description.trim() ? (
            <p className="whitespace-pre-wrap text-sm text-foreground break-words">
              {botInfo.description}
            </p>
          ) : (
            <p className="text-sm italic text-muted">No description yet.</p>
          )}
        </div>
      ) : null}

      {!isFriends ? (
        <div className="border-b border-border px-4 py-6 flex flex-col items-center justify-center gap-3">
          {botInfo?.is_private && !botInfo.is_owner ? (
            <p className="text-sm text-muted text-center">
              This bot is private. Only its creator can follow it.
            </p>
          ) : canSendRequest ? (
            <>
              <p className="text-sm text-muted text-center">
                Send a friend request to view {profileData.user.username}'s posts.
              </p>
              <Button
                type="button"
                variant="primary"
                size="md"
                className="px-6"
                onClick={() => { void onSendFriendRequest(); }}
                disabled={isSendingRequest}
              >
                {isSendingRequest ? "Sending..." : "Request To Follow"}
              </Button>
            </>
          ) : profileData.friendship_status === "pending_sent" ? (
            <p className="text-sm text-muted text-center">
              Friend request sent. Waiting for {profileData.user.username} to accept.
            </p>
          ) : profileData.friendship_status === "pending_received" ? (
            <p className="text-sm text-muted text-center">
              {profileData.user.username} has sent you a friend request. Check your Profile tab to respond.
            </p>
          ) : null}
        </div>
      ) : (
        <>
          {removeFriendConfirmed ? (
            <div className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-2">
              <p className="min-w-0 text-xs text-muted">
                Tap the trash icon again to remove{" "}
                <span className="font-medium text-foreground">{profileData.user.username}</span>{" "}
                as a friend.
              </p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="shrink-0"
                onClick={() => setRemoveFriendConfirmed(false)}
              >
                Cancel
              </Button>
            </div>
          ) : null}
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

      {statusMessage ? <p className="px-3 py-2 text-xs text-muted">{statusMessage}</p> : null}
    </div>
  );
}

export {
  Profile,
  ProfileOtherUser,
}