"use client";

import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ImagePlus, Plus, Settings, Users } from "lucide-react";
import Loader from "@/app/components/Loader";
import Camera from "@/app/components/Camera";
import EventDateTimeSelect, { isoToEventLocalDatetime } from "@/app/components/EventDateTimeSelect";
import { PostSection } from "@/app/components/PostSection";
import UserProfileImage from "@/app/components/UserProfileImage";
import BackButton from "@/app/components/utils/BackButton";
import {
  prepareImageForUpload,
  prepareVideoForUpload,
  uploadPreparedImageToMainBucket,
  uploadPreparedVideoToMainBucket,
} from "@/app/components/utils/client_file_storage_utils";
import { MAX_SHARED_POST_MEDIA_PER_CONTRIBUTOR } from "@/app/lib/sharedPosts";
import {
  AcceptedFriend,
  ApiError,
  FriendRequestsListResponse,
  PostData,
  PostItem,
  PostMediaItem,
  SharedPostListItem,
  SharedPostsListRequest,
  SharedPostsListResponse,
} from "@/app/types/interfaces";

const SHARED_POST_UPLOAD_ACCEPT = "image/*,video/mp4,video/webm,video/quicktime,.mov";

type ViewMode =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "settings"; sharedPostId: string }
  | { kind: "detail"; sharedPostId: string };

const postWithAuth = async (path: string, body: unknown = {}): Promise<Response> =>
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

const formatDateLabel = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const localDatetimeToIso = (localValue: string): string => {
  const date = new Date(localValue);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString();
};

const defaultCloseLocal = (): string => {
  const d = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const defaultReleaseLocal = (): string => {
  const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const toPostItem = (item: SharedPostListItem): PostItem => ({
  kind: "shared_event",
  id: item.id,
  shared_post_id: item.id,
  title: item.title,
  close_at: item.close_at,
  release_at: item.release_at,
  created_at: item.release_at,
  created_by: item.created_by,
  image_id: item.image_id,
  image_url: null,
  image_access_grant: item.image_access_grant ?? null,
  text: item.text ?? "",
  data: item.data,
  like_count: item.like_count,
  is_liked_by_viewer: item.is_liked_by_viewer,
  username: item.username,
  email: item.email,
  author_profile_image_id: item.author_profile_image_id,
  author_profile_image_access_grant: item.author_profile_image_access_grant,
});

export default function SharedEventPostsTab({
  currentUserId,
  isActive,
}: {
  currentUserId: string;
  isActive: boolean;
}) {
  const [view, setView] = useState<ViewMode>({ kind: "list" });
  const [openPosts, setOpenPosts] = useState<SharedPostListItem[]>([]);
  const [pendingPosts, setPendingPosts] = useState<SharedPostListItem[]>([]);
  const [releasedPosts, setReleasedPosts] = useState<SharedPostListItem[]>([]);
  const [isReleasedExpanded, setIsReleasedExpanded] = useState(false);
  const [isLoadingReleased, setIsLoadingReleased] = useState(false);
  const [hasLoadedReleased, setHasLoadedReleased] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState("");

  const [createTitle, setCreateTitle] = useState("");
  const [createCloseAt, setCreateCloseAt] = useState(defaultCloseLocal);
  const [createReleaseAt, setCreateReleaseAt] = useState(defaultReleaseLocal);
  const [selectedInviteeIds, setSelectedInviteeIds] = useState<Set<string>>(new Set());
  const [friends, setFriends] = useState<AcceptedFriend[]>([]);
  const [isLoadingFriends, setIsLoadingFriends] = useState(false);
  const [isSavingEditor, setIsSavingEditor] = useState(false);
  const [isLoadingSettings, setIsLoadingSettings] = useState(false);

  const [detailPost, setDetailPost] = useState<SharedPostListItem | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isContributing, setIsContributing] = useState(false);
  const [contributeStatus, setContributeStatus] = useState("");
  const [contributeCameraPostId, setContributeCameraPostId] = useState<string | null>(null);
  const [contributeUploadPostId, setContributeUploadPostId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const listUploadInputRef = useRef<HTMLInputElement | null>(null);

  const loadList = useCallback(async () => {
    setIsLoading(true);
    setStatusMessage("");
    try {
      const body: SharedPostsListRequest = { phases: ["open", "pending"] };
      const response = await postWithAuth("/api/shared-posts-list", body);
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }
      const payload = (await response.json()) as SharedPostsListResponse;
      setOpenPosts(payload.open);
      setPendingPosts(payload.pending);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to load shared posts.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadReleased = useCallback(async () => {
    setIsLoadingReleased(true);
    setStatusMessage("");
    try {
      const body: SharedPostsListRequest = { phases: ["released"] };
      const response = await postWithAuth("/api/shared-posts-list", body);
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }
      const payload = (await response.json()) as SharedPostsListResponse;
      setReleasedPosts(payload.released);
      setHasLoadedReleased(true);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to load released posts.");
    } finally {
      setIsLoadingReleased(false);
    }
  }, []);

  useEffect(() => {
    if (!isActive || view.kind !== "list") {
      return;
    }
    void loadList();
  }, [isActive, view.kind, loadList]);

  useEffect(() => {
    if (!isActive || view.kind !== "list" || !isReleasedExpanded) {
      return;
    }
    void loadReleased();
  }, [isActive, view.kind, isReleasedExpanded, loadReleased]);

  const onToggleReleasedSection = () => {
    setIsReleasedExpanded((prev) => !prev);
  };

  const loadDetail = useCallback(async (sharedPostId: string) => {
    setIsLoadingDetail(true);
    setContributeStatus("");
    try {
      const response = await postWithAuth("/api/shared-post-get", { shared_post_id: sharedPostId });
      if (!response.ok) {
        setContributeStatus(await readErrorMessage(response));
        return;
      }
      const payload = (await response.json()) as { shared_post: SharedPostListItem };
      setDetailPost(payload.shared_post);
    } catch (error) {
      setContributeStatus(error instanceof Error ? error.message : "Failed to load shared post.");
    } finally {
      setIsLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (view.kind !== "detail") {
      return;
    }
    void loadDetail(view.sharedPostId);
  }, [view, loadDetail]);

  const loadFriends = useCallback(async () => {
    setIsLoadingFriends(true);
    try {
      const response = await postWithAuth("/api/friend-requests-list", {});
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as FriendRequestsListResponse;
      setFriends(payload.accepted_friends ?? []);
    } catch {
      // Keep prior list; create/detail can still proceed without invites.
    } finally {
      setIsLoadingFriends(false);
    }
  }, []);

  useEffect(() => {
    if (!isActive || (view.kind !== "create" && view.kind !== "settings")) {
      return;
    }
    void loadFriends();
  }, [isActive, view.kind, loadFriends]);

  const onOpenCreate = () => {
    setCreateTitle("");
    setCreateCloseAt(defaultCloseLocal());
    setCreateReleaseAt(defaultReleaseLocal());
    setSelectedInviteeIds(new Set());
    setStatusMessage("");
    setView({ kind: "create" });
  };

  const onOpenSettings = (sharedPostId: string) => {
    setStatusMessage("");
    setSelectedInviteeIds(new Set());
    setView({ kind: "settings", sharedPostId });
  };

  useEffect(() => {
    if (view.kind !== "settings") {
      return;
    }
    let cancelled = false;
    setIsLoadingSettings(true);
    setStatusMessage("");
    void postWithAuth("/api/shared-post-get", { shared_post_id: view.sharedPostId })
      .then(async (response) => {
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          setStatusMessage(await readErrorMessage(response));
          return;
        }
        const payload = (await response.json()) as { shared_post: SharedPostListItem };
        const post = payload.shared_post;
        setCreateTitle(post.title);
        setCreateCloseAt(isoToEventLocalDatetime(post.close_at));
        setCreateReleaseAt(isoToEventLocalDatetime(post.release_at));
        const invitedIds = (post.contributors ?? [])
          .map((row) => row.user_id)
          .filter((userId) => userId !== currentUserId);
        setSelectedInviteeIds(new Set(invitedIds));
      })
      .catch((error) => {
        if (!cancelled) {
          setStatusMessage(error instanceof Error ? error.message : "Failed to load settings.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingSettings(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [view, currentUserId]);

  const toggleCreateInvitee = (userId: string) => {
    setSelectedInviteeIds((previous) => {
      const next = new Set(previous);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const onCreateSubmit = async () => {
    if (isSavingEditor) {
      return;
    }
    setIsSavingEditor(true);
    setStatusMessage("");
    try {
      const response = await postWithAuth("/api/shared-post-create", {
        title: createTitle.trim(),
        close_at: localDatetimeToIso(createCloseAt),
        release_at: localDatetimeToIso(createReleaseAt),
        invitee_user_ids: Array.from(selectedInviteeIds),
      });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }
      const payload = (await response.json()) as { shared_post: SharedPostListItem };
      setView({ kind: "detail", sharedPostId: payload.shared_post.id });
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to create shared post.");
    } finally {
      setIsSavingEditor(false);
    }
  };

  const onSettingsSubmit = async () => {
    if (view.kind !== "settings" || isSavingEditor) {
      return;
    }
    setIsSavingEditor(true);
    setStatusMessage("");
    try {
      const response = await postWithAuth("/api/shared-post-update", {
        shared_post_id: view.sharedPostId,
        title: createTitle.trim(),
        close_at: localDatetimeToIso(createCloseAt),
        release_at: localDatetimeToIso(createReleaseAt),
        invitee_user_ids: Array.from(selectedInviteeIds),
      });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }
      setView({ kind: "list" });
      void loadList();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to save shared post.");
    } finally {
      setIsSavingEditor(false);
    }
  };

  const contributeMediaFiles = async (sharedPostId: string, files: File[]) => {
    const filesToUpload = files
      .filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/"))
      .slice(0, MAX_SHARED_POST_MEDIA_PER_CONTRIBUTOR);
    if (filesToUpload.length === 0) {
      throw new Error("No photos or videos to upload.");
    }

    const media: PostMediaItem[] = [];
    for (const file of filesToUpload) {
      if (file.type.startsWith("image/")) {
        const prepared = await prepareImageForUpload(file);
        const uploaded = await uploadPreparedImageToMainBucket(prepared, postWithAuth);
        media.push({
          id: uploaded.image_id,
          kind: "image",
          owner_user_id: currentUserId,
        });
        continue;
      }

      const preparedVideo = await prepareVideoForUpload(file);
      try {
        const uploaded = await uploadPreparedVideoToMainBucket(preparedVideo, postWithAuth);
        media.push({
          id: uploaded.video_id,
          kind: "video",
          poster_id: uploaded.poster_id,
          owner_user_id: currentUserId,
        });
      } finally {
        URL.revokeObjectURL(preparedVideo.previewObjectUrl);
      }
    }

    const response = await postWithAuth("/api/shared-post-contribute", {
      shared_post_id: sharedPostId,
      media,
    });
    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }
    const payload = (await response.json()) as { contributed_count?: number };
    return {
      addedCount: media.length,
      contributedCount: payload.contributed_count ?? media.length,
    };
  };

  const markOpenPostContributed = (sharedPostId: string) => {
    setOpenPosts((previous) =>
      previous.map((item) =>
        item.id === sharedPostId ? { ...item, viewer_has_contributed: true } : item,
      ),
    );
  };

  const contributeStatusLabel = (addedCount: number): string => {
    if (addedCount === 1) {
      return "Added 1 item (hidden until release).";
    }
    return `Added ${addedCount} items (hidden until release).`;
  };

  const onPickContributeFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!detailPost || files.length === 0 || isContributing) {
      return;
    }

    setIsContributing(true);
    setContributeStatus("");
    try {
      const result = await contributeMediaFiles(detailPost.id, files);
      setContributeStatus(
        `${contributeStatusLabel(result.addedCount)} You have contributed ${result.contributedCount} total.`,
      );
      setDetailPost((previous) =>
        previous
          ? {
              ...previous,
              viewer_has_contributed: true,
            }
          : previous,
      );
    } catch (error) {
      setContributeStatus(error instanceof Error ? error.message : "Failed to contribute media.");
    } finally {
      setIsContributing(false);
    }
  };

  const onPickListContributeFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    const sharedPostId = contributeUploadPostId;
    setContributeUploadPostId(null);
    if (!sharedPostId || files.length === 0 || isContributing) {
      return;
    }

    setIsContributing(true);
    setStatusMessage("");
    try {
      const result = await contributeMediaFiles(sharedPostId, files);
      markOpenPostContributed(sharedPostId);
      setStatusMessage(contributeStatusLabel(result.addedCount));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to contribute media.");
    } finally {
      setIsContributing(false);
    }
  };

  const onOpenUploadPicker = (sharedPostId: string) => {
    if (isContributing) {
      return;
    }
    setStatusMessage("");
    setContributeUploadPostId(sharedPostId);
    listUploadInputRef.current?.click();
  };

  const onSendPhotoFromCamera = async (payload: {
    file: File;
    overlayText: string;
    overlayYRatio: number;
  }) => {
    if (!contributeCameraPostId) {
      throw new Error("No shared post selected.");
    }
    const sharedPostId = contributeCameraPostId;
    setIsContributing(true);
    setStatusMessage("");
    try {
      const result = await contributeMediaFiles(sharedPostId, [payload.file]);
      markOpenPostContributed(sharedPostId);
      setStatusMessage(contributeStatusLabel(result.addedCount));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to contribute photo.");
      throw error;
    } finally {
      setIsContributing(false);
    }
  };

  const onDetailPostUpdated = (updated: {
    id: string;
    data?: PostData | null;
    text?: string;
    like_count?: number;
    is_liked_by_viewer?: boolean;
  }) => {
    setDetailPost((previous) => {
      if (!previous || previous.id !== updated.id) {
        return previous;
      }
      return {
        ...previous,
        ...(updated.data !== undefined ? { data: updated.data } : {}),
        ...(updated.like_count !== undefined ? { like_count: updated.like_count } : {}),
        ...(updated.is_liked_by_viewer !== undefined
          ? { is_liked_by_viewer: updated.is_liked_by_viewer }
          : {}),
      };
    });
  };

  const renderContributionMeta = (item: SharedPostListItem) => (
    <p
      className={`mt-0.5 text-[11px] ${
        item.viewer_has_contributed ? "text-accent" : "text-muted"
      }`}
    >
      {item.viewer_has_contributed ? "You've contributed" : "You haven't contributed"}
      {" · "}
      {item.others_contributed_count === 1
        ? "1 other contributed"
        : `${item.others_contributed_count} others contributed`}
    </p>
  );

  const renderSharedPostRow = (
    item: SharedPostListItem,
    subtitle: string,
    onMainClick: () => void,
  ) => (
    <div
      key={item.id}
      className="flex items-stretch overflow-hidden rounded-xl border border-border bg-surface"
    >
      <button
        type="button"
        onClick={onMainClick}
        className="min-w-0 flex-1 px-3 py-3 text-left transition hover:bg-bg/40"
      >
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-foreground">{item.title}</p>
          <span className="shrink-0 text-[11px] text-muted">
            <Users className="mr-1 inline h-3 w-3" />
            {item.contributor_count}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted">{subtitle}</p>
        {renderContributionMeta(item)}
      </button>
      {item.is_creator ? (
        <button
          type="button"
          aria-label="Shared post settings"
          onClick={() => onOpenSettings(item.id)}
          className="flex shrink-0 items-center justify-center border-l border-border px-3 text-muted transition hover:bg-bg/40 hover:text-foreground"
        >
          <Settings className="h-5 w-5" />
        </button>
      ) : null}
    </div>
  );

  const renderOpenSharedPostRow = (item: SharedPostListItem) => (
    <div
      key={item.id}
      className="flex items-stretch overflow-hidden rounded-xl border border-border bg-surface"
    >
      <div className="min-w-0 flex-1 px-3 py-3">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-foreground">{item.title}</p>
          <span className="shrink-0 text-[11px] text-muted">
            <Users className="mr-1 inline h-3 w-3" />
            {item.contributor_count}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted">Closes {formatDateLabel(item.close_at)}</p>
        {renderContributionMeta(item)}
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={isContributing}
            onClick={() => {
              setStatusMessage("");
              setContributeCameraPostId(item.id);
            }}
            className="create-post-rgb-border inline-flex min-w-0 flex-1 flex-col items-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold transition disabled:opacity-50"
          >
            <span className="create-post-rgb-icon create-post-rgb-icon-camera" aria-hidden />
            <span className="create-post-rgb-text text-center">Take Photo</span>
          </button>
          <button
            type="button"
            disabled={isContributing}
            onClick={() => onOpenUploadPicker(item.id)}
            className="create-post-rgb-border inline-flex min-w-0 flex-1 flex-col items-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold transition disabled:opacity-50"
          >
            <span className="create-post-rgb-icon" aria-hidden />
            <span className="create-post-rgb-text text-center">Upload Photos</span>
          </button>
        </div>
      </div>
      {item.is_creator ? (
        <button
          type="button"
          aria-label="Shared post settings"
          onClick={() => onOpenSettings(item.id)}
          className="flex shrink-0 items-center justify-center border-l border-border px-3 text-muted transition hover:bg-bg/40 hover:text-foreground"
        >
          <Settings className="h-5 w-5" />
        </button>
      ) : null}
    </div>
  );

  if (view.kind === "create" || view.kind === "settings") {
    const isSettings = view.kind === "settings";
    return (
      <div className="flex h-full min-h-0 flex-col bg-bg">
        <header className="flex items-center justify-between border-b border-border px-3 py-2">
          <BackButton onBack={() => setView({ kind: "list" })} />
          <h1 className="text-sm font-semibold text-foreground">
            {isSettings ? "Shared Event Settings" : "Create Shared Event"}
          </h1>
          <div className="w-20" />
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3">
          {isSettings && isLoadingSettings ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-xs text-muted">
              <Loader />
              <span>Loading</span>
            </div>
          ) : (
            <>
              <label className="block space-y-1">
                <span className="text-xs text-muted">Event title</span>
                <input
                  value={createTitle}
                  onChange={(event) => setCreateTitle(event.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-muted"
                  placeholder="Weekend trip"
                />
              </label>
              <EventDateTimeSelect
                label="Allow adding until..."
                value={createCloseAt}
                onChange={setCreateCloseAt}
                compactFields
              />
              <EventDateTimeSelect
                label="Release shared post at..."
                value={createReleaseAt}
                onChange={setCreateReleaseAt}
                compactFields
              />

              <div className="space-y-2">
                <p className="text-xs text-muted">
                  Invite friends
                  {selectedInviteeIds.size > 0 ? ` (${selectedInviteeIds.size})` : ""}
                </p>
                {isLoadingFriends ? (
                  <div className="flex items-center gap-2 py-3 text-xs text-muted">
                    <Loader scale={0.7} />
                    <span>Loading friends</span>
                  </div>
                ) : friends.length === 0 ? (
                  <p className="text-xs text-muted">No friends to invite yet.</p>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-border">
                    {friends.map((friend) => {
                      const selected = selectedInviteeIds.has(friend.user_id);
                      return (
                        <button
                          key={friend.user_id}
                          type="button"
                          onClick={() => toggleCreateInvitee(friend.user_id)}
                          className="flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left last:border-b-0 transition hover:bg-surface"
                        >
                          <UserProfileImage
                            userId={friend.user_id}
                            sizePx={36}
                            alt={`${friend.username} profile`}
                            signedUrl={friend.profile_image_url}
                            imageAccessGrant={friend.profile_image_access_grant}
                            imageStorageUserId={friend.user_id}
                            imageId={friend.profile_image_id}
                          />
                          <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                            {friend.username}
                          </span>
                          <span
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                              selected
                                ? "border-accent bg-accent text-on-accent"
                                : "border-muted text-transparent"
                            }`}
                            aria-hidden
                          >
                            <Check className="h-3.5 w-3.5" />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {statusMessage ? <p className="text-xs text-muted">{statusMessage}</p> : null}

              <button
                type="button"
                disabled={isSavingEditor || !createTitle.trim()}
                onClick={() => void (isSettings ? onSettingsSubmit() : onCreateSubmit())}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-accent bg-surface py-3 text-sm font-semibold text-accent disabled:opacity-50"
              >
                {isSavingEditor ? (
                  <Loader scale={0.55} />
                ) : isSettings ? null : (
                  <Plus className="h-4 w-4" />
                )}
                {isSettings ? "Save" : "Create"}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (view.kind === "detail") {
    return (
      <div className="flex h-full min-h-0 flex-col bg-bg">
        <header className="flex items-center gap-2 border-b border-border px-2 py-2">
          <BackButton
            onBack={() => {
              setDetailPost(null);
              setView({ kind: "list" });
            }}
          />
          <h1 className="truncate text-sm font-semibold text-foreground">
            {detailPost?.title ?? "Shared Event"}
          </h1>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {isLoadingDetail || !detailPost ? (
            <div className="flex flex-col items-center justify-center gap-2 px-3 py-8 text-xs text-muted">
              <Loader />
              <span>Loading</span>
            </div>
          ) : detailPost.phase === "released" ? (
            <PostSection
              post={toPostItem(detailPost)}
              currentUserId={currentUserId}
              onPostUpdated={onDetailPostUpdated}
            />
          ) : (
            <div className="space-y-4 px-3 py-3">
              <div className="space-y-1">
                <p className="text-base font-semibold text-foreground">{detailPost.title}</p>
                <p className="text-xs text-muted">
                  Closes {formatDateLabel(detailPost.close_at)} · Releases{" "}
                  {formatDateLabel(detailPost.release_at)}
                </p>
                <p className="text-xs text-muted">
                  {detailPost.phase === "open"
                    ? "Photos and videos stay hidden until release."
                    : "Contributions are closed. Waiting for release."}
                </p>
              </div>

              {detailPost.phase === "open" ? (
                <div className="space-y-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={SHARED_POST_UPLOAD_ACCEPT}
                    multiple
                    className="hidden"
                    onChange={(event) => void onPickContributeFiles(event)}
                  />
                  <button
                    type="button"
                    disabled={isContributing}
                    onClick={() => fileInputRef.current?.click()}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-accent bg-surface py-3 text-sm font-semibold text-accent disabled:opacity-50"
                  >
                    {isContributing ? (
                      <Loader scale={0.55} />
                    ) : (
                      <ImagePlus className="h-4 w-4" />
                    )}
                    Upload photos or videos
                  </button>
                  <p className="text-[11px] text-muted">
                    Up to {MAX_SHARED_POST_MEDIA_PER_CONTRIBUTOR} photos or videos per person. No
                    previews.
                  </p>
                </div>
              ) : null}

              {contributeStatus ? <p className="text-xs text-muted">{contributeStatus}</p> : null}

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted">
                  Invitees ({detailPost.contributors?.length ?? detailPost.contributor_count})
                </p>
                <div className="space-y-1">
                  {(detailPost.contributors ?? []).map((contributor) => (
                    <div
                      key={contributor.user_id}
                      className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                    >
                      <span className="text-sm text-foreground">{contributor.username}</span>
                      <span className="text-[11px] text-muted">
                        {contributor.has_contributed ? "Contributed" : "Invited"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <header className="flex items-center justify-between gap-3 border-b border-border px-3 py-3">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-foreground">Shared Event Posts</h1>
          <p className="text-xs text-muted">Contribute blindly. Reveal together.</p>
        </div>
        <button
          type="button"
          onClick={onOpenCreate}
          aria-label="Create Shared Post"
          className="create-post-rgb-border flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition hover:opacity-90"
        >
          <span className="create-post-rgb-text text-xl font-semibold leading-none" aria-hidden>
            +
          </span>
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-4">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-xs text-muted">
            <Loader />
            <span>Loading</span>
          </div>
        ) : null}

        {statusMessage ? <p className="text-xs text-muted">{statusMessage}</p> : null}

        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
            Open Shared Posts
          </h2>
          {openPosts.length === 0 ? (
            <p className="text-xs text-muted">No open shared posts.</p>
          ) : (
            openPosts.map((item) => renderOpenSharedPostRow(item))
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
            Pending Posts
          </h2>
          {pendingPosts.length === 0 ? (
            <p className="text-xs text-muted">Nothing waiting to release.</p>
          ) : (
            pendingPosts.map((item) =>
              renderSharedPostRow(item, `Releases ${formatDateLabel(item.release_at)}`, () => {
                setView({ kind: "detail", sharedPostId: item.id });
              }),
            )
          )}
        </section>

        <section className="space-y-2">
          <button
            type="button"
            onClick={onToggleReleasedSection}
            aria-expanded={isReleasedExpanded}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
              Released
            </h2>
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-muted transition-transform ${
                isReleasedExpanded ? "rotate-180" : ""
              }`}
            />
          </button>
          {isReleasedExpanded ? (
            isLoadingReleased && !hasLoadedReleased ? (
              <div className="flex flex-col items-center justify-center gap-2 py-4 text-xs text-muted">
                <Loader />
                <span>Loading</span>
              </div>
            ) : releasedPosts.length === 0 ? (
              <p className="text-xs text-muted">No released shared posts yet.</p>
            ) : (
              releasedPosts.map((item) =>
                renderSharedPostRow(item, `Released ${formatDateLabel(item.release_at)}`, () => {
                  setView({ kind: "detail", sharedPostId: item.id });
                }),
              )
            )
          ) : null}
        </section>
      </div>

      <input
        ref={listUploadInputRef}
        type="file"
        accept={SHARED_POST_UPLOAD_ACCEPT}
        multiple
        className="hidden"
        onChange={(event) => void onPickListContributeFiles(event)}
      />

      <Camera
        isOpen={contributeCameraPostId !== null}
        onClose={() => setContributeCameraPostId(null)}
        onSendPhoto={onSendPhotoFromCamera}
        isSending={isContributing}
        surfaceClassName="z-[2300]"
      />
    </div>
  );
}
