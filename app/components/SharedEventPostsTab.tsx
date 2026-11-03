"use client";

import {
  ChangeEvent,
  CSSProperties,
  TouchEvent,
  WheelEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  CheckIcon,
  ChevronDownIcon,
  AddImageIcon,
  AddIcon,
  SettingsIcon,
  LockIcon,
  WaxSealIcon,
  ClockIcon,
  CameraIcon,
  CloseIcon,
  RefreshIcon,
} from "@/app/components/Icons";
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
import { DONT_SWIPE_TABS_CLASSNAME } from "@/app/components/utils/useSwipeBack";
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
const EDITOR_CLOSE_ANIMATION_MS = 200;
const SHARED_EVENTS_LIST_CACHE_TTL_MS = 60_000;
const TOP_REFRESH_COOLDOWN_MS = 1500;
const PULL_REFRESH_THRESHOLD_PX = 55;
const MIN_REFRESH_SPIN_MS = 1_000;

type ViewMode = { kind: "list" } | { kind: "detail"; sharedPostId: string };

type EditorMode =
  | { kind: "create" }
  | { kind: "settings"; sharedPostId: string };

type SharedEventsOpenCache = {
  fetchedAt: number;
  open: SharedPostListItem[];
  pending: SharedPostListItem[];
};

type SharedEventsReleasedCache = {
  fetchedAt: number;
  released: SharedPostListItem[];
};

let sharedEventsOpenCache: SharedEventsOpenCache | null = null;
let sharedEventsReleasedCache: SharedEventsReleasedCache | null = null;

const readFreshOpenCache = (): SharedEventsOpenCache | null => {
  if (!sharedEventsOpenCache) {
    return null;
  }
  if (Date.now() - sharedEventsOpenCache.fetchedAt >= SHARED_EVENTS_LIST_CACHE_TTL_MS) {
    sharedEventsOpenCache = null;
    return null;
  }
  return sharedEventsOpenCache;
};

const writeOpenCache = (open: SharedPostListItem[], pending: SharedPostListItem[]) => {
  sharedEventsOpenCache = { fetchedAt: Date.now(), open, pending };
};

const readFreshReleasedCache = (): SharedEventsReleasedCache | null => {
  if (!sharedEventsReleasedCache) {
    return null;
  }
  if (Date.now() - sharedEventsReleasedCache.fetchedAt >= SHARED_EVENTS_LIST_CACHE_TTL_MS) {
    sharedEventsReleasedCache = null;
    return null;
  }
  return sharedEventsReleasedCache;
};

const writeReleasedCache = (released: SharedPostListItem[]) => {
  sharedEventsReleasedCache = { fetchedAt: Date.now(), released };
};

const invalidateSharedEventsCaches = () => {
  sharedEventsOpenCache = null;
  sharedEventsReleasedCache = null;
};

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

const formatCountdown = (iso: string): string => {
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms) || ms <= 0) {
    return "0m";
  }
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) {
    return `${days}d ${String(hours).padStart(2, "0")}h`;
  }
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  return `${minutes}m`;
};

const formatReleaseShort = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
};

const sealedContributorCount = (item: SharedPostListItem): number =>
  (item.viewer_has_contributed ? 1 : 0) + item.others_contributed_count;

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
  const [editor, setEditor] = useState<EditorMode | null>(null);
  const [isEditorClosing, setIsEditorClosing] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [openPosts, setOpenPosts] = useState<SharedPostListItem[]>(
    () => readFreshOpenCache()?.open ?? [],
  );
  const [pendingPosts, setPendingPosts] = useState<SharedPostListItem[]>(
    () => readFreshOpenCache()?.pending ?? [],
  );
  const [releasedPosts, setReleasedPosts] = useState<SharedPostListItem[]>([]);
  const [isReleasedExpanded, setIsReleasedExpanded] = useState(false);
  const [isLoadingReleased, setIsLoadingReleased] = useState(false);
  const [hasLoadedReleased, setHasLoadedReleased] = useState(false);
  const [isLoading, setIsLoading] = useState(() => !readFreshOpenCache());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const openPostsRef = useRef<SharedPostListItem[]>([]);
  const pendingPostsRef = useRef<SharedPostListItem[]>([]);
  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const pullStartYRef = useRef<number | null>(null);
  const pullRefreshTriggeredRef = useRef(false);
  const lastTopRefreshAtRef = useRef(0);
  const isReleasedExpandedRef = useRef(false);
  const hasLoadedReleasedRef = useRef(false);

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
  const editorCloseTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    setIsMounted(true);
    return () => {
      if (editorCloseTimeoutRef.current !== null) {
        window.clearTimeout(editorCloseTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    openPostsRef.current = openPosts;
  }, [openPosts]);

  useEffect(() => {
    pendingPostsRef.current = pendingPosts;
  }, [pendingPosts]);

  useEffect(() => {
    isReleasedExpandedRef.current = isReleasedExpanded;
  }, [isReleasedExpanded]);

  useEffect(() => {
    hasLoadedReleasedRef.current = hasLoadedReleased;
  }, [hasLoadedReleased]);

  const loadList = useCallback(async ({ force = false }: { force?: boolean } = {}) => {
    if (!force) {
      const cached = readFreshOpenCache();
      if (cached) {
        setOpenPosts(cached.open);
        setPendingPosts(cached.pending);
        setIsLoading(false);
        return;
      }
    }

    const hasExisting =
      openPostsRef.current.length > 0 || pendingPostsRef.current.length > 0;
    if (!hasExisting) {
      setIsLoading(true);
    }
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
      writeOpenCache(payload.open, payload.pending);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to load shared posts.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadReleased = useCallback(async ({ force = false }: { force?: boolean } = {}) => {
    if (!force) {
      const cached = readFreshReleasedCache();
      if (cached) {
        setReleasedPosts(cached.released);
        setHasLoadedReleased(true);
        setIsLoadingReleased(false);
        return;
      }
    }

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
      writeReleasedCache(payload.released);
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

  const onRefreshSharedEvents = useCallback(async () => {
    if (isRefreshing) {
      return;
    }
    setIsRefreshing(true);
    setStatusMessage("");
    const startedAt = Date.now();
    try {
      await loadList({ force: true });
      if (isReleasedExpandedRef.current || hasLoadedReleasedRef.current) {
        await loadReleased({ force: true });
      }
    } finally {
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_REFRESH_SPIN_MS) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, MIN_REFRESH_SPIN_MS - elapsed);
        });
      }
      setIsRefreshing(false);
    }
  }, [isRefreshing, loadList, loadReleased]);

  const triggerTopRefresh = useCallback(() => {
    const now = Date.now();
    if (isLoading || isRefreshing || now - lastTopRefreshAtRef.current < TOP_REFRESH_COOLDOWN_MS) {
      return;
    }
    lastTopRefreshAtRef.current = now;
    void onRefreshSharedEvents();
  }, [isLoading, isRefreshing, onRefreshSharedEvents]);

  const onListTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    pullStartYRef.current = event.touches[0]?.clientY ?? null;
    pullRefreshTriggeredRef.current = false;
  };

  const onListTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    if (pullRefreshTriggeredRef.current) {
      return;
    }
    const startY = pullStartYRef.current;
    const currentY = event.touches[0]?.clientY;
    const container = listContainerRef.current;
    if (startY === null || currentY === undefined || !container) {
      return;
    }
    if (container.scrollTop > 0) {
      return;
    }
    if (currentY - startY >= PULL_REFRESH_THRESHOLD_PX) {
      pullRefreshTriggeredRef.current = true;
      triggerTopRefresh();
    }
  };

  const resetPullGesture = () => {
    pullStartYRef.current = null;
    pullRefreshTriggeredRef.current = false;
  };

  const onListWheel = (event: WheelEvent<HTMLDivElement>) => {
    const container = listContainerRef.current;
    if (!container) {
      return;
    }
    if (container.scrollTop <= 0 && event.deltaY < -30) {
      triggerTopRefresh();
    }
  };

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
    if (!isActive || !editor) {
      return;
    }
    void loadFriends();
  }, [isActive, editor, loadFriends]);

  const closeEditor = useCallback(() => {
    if (!editor || isEditorClosing) {
      return;
    }
    setIsEditorClosing(true);
    const closeDelayMs = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 0
      : EDITOR_CLOSE_ANIMATION_MS;
    if (editorCloseTimeoutRef.current !== null) {
      window.clearTimeout(editorCloseTimeoutRef.current);
    }
    editorCloseTimeoutRef.current = window.setTimeout(() => {
      setEditor(null);
      setIsEditorClosing(false);
      setStatusMessage("");
      editorCloseTimeoutRef.current = null;
    }, closeDelayMs);
  }, [editor, isEditorClosing]);

  const onOpenCreate = () => {
    if (editorCloseTimeoutRef.current !== null) {
      window.clearTimeout(editorCloseTimeoutRef.current);
      editorCloseTimeoutRef.current = null;
    }
    setCreateTitle("");
    setCreateCloseAt(defaultCloseLocal());
    setCreateReleaseAt(defaultReleaseLocal());
    setSelectedInviteeIds(new Set());
    setStatusMessage("");
    setIsEditorClosing(false);
    setEditor({ kind: "create" });
  };

  const onOpenSettings = (sharedPostId: string) => {
    if (editorCloseTimeoutRef.current !== null) {
      window.clearTimeout(editorCloseTimeoutRef.current);
      editorCloseTimeoutRef.current = null;
    }
    setStatusMessage("");
    setSelectedInviteeIds(new Set());
    setIsEditorClosing(false);
    setEditor({ kind: "settings", sharedPostId });
  };

  useEffect(() => {
    if (!editor || isEditorClosing) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeEditor();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [editor, isEditorClosing, closeEditor]);

  useEffect(() => {
    if (editor?.kind !== "settings") {
      return;
    }
    let cancelled = false;
    setIsLoadingSettings(true);
    setStatusMessage("");
    void postWithAuth("/api/shared-post-get", { shared_post_id: editor.sharedPostId })
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
  }, [editor, currentUserId]);

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
      if (editorCloseTimeoutRef.current !== null) {
        window.clearTimeout(editorCloseTimeoutRef.current);
        editorCloseTimeoutRef.current = null;
      }
      invalidateSharedEventsCaches();
      setEditor(null);
      setIsEditorClosing(false);
      setView({ kind: "detail", sharedPostId: payload.shared_post.id });
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to create shared post.");
    } finally {
      setIsSavingEditor(false);
    }
  };

  const onSettingsSubmit = async () => {
    if (editor?.kind !== "settings" || isSavingEditor) {
      return;
    }
    setIsSavingEditor(true);
    setStatusMessage("");
    try {
      const response = await postWithAuth("/api/shared-post-update", {
        shared_post_id: editor.sharedPostId,
        title: createTitle.trim(),
        close_at: localDatetimeToIso(createCloseAt),
        release_at: localDatetimeToIso(createReleaseAt),
        invitee_user_ids: Array.from(selectedInviteeIds),
      });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }
      invalidateSharedEventsCaches();
      closeEditor();
      void loadList({ force: true });
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
    setOpenPosts((previous) => {
      const next = previous.map((item) =>
        item.id === sharedPostId ? { ...item, viewer_has_contributed: true } : item,
      );
      writeOpenCache(next, pendingPostsRef.current);
      return next;
    });
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

  const onOpenCamera = (sharedPostId: string) => {
    if (isContributing) {
      return;
    }
    setStatusMessage("");
    setContributeCameraPostId(sharedPostId);
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

  const renderContributeButtons = (sharedPostId: string, compact = false) => (
    <div className={`relative z-[1] flex gap-2 ${compact ? "mt-3" : "mt-4"}`}>
      <button
        type="button"
        disabled={isContributing}
        onClick={() => onOpenCamera(sharedPostId)}
        className="shared-event-add-shot inline-flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-2 py-2.5 text-sm font-semibold"
      >
        <CameraIcon className={compact ? "h-4 w-4" : "h-5 w-5"} />
        Take Photo
      </button>
      <button
        type="button"
        disabled={isContributing}
        onClick={() => onOpenUploadPicker(sharedPostId)}
        className="shared-event-add-shot inline-flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-2 py-2.5 text-sm font-semibold"
      >
        <AddImageIcon className={compact ? "h-4 w-4" : "h-5 w-5"} />
        Upload Photo
      </button>
    </div>
  );

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

  const renderContributorAvatars = (item: SharedPostListItem, sizePx = 34) => {
    const contributors = item.contributors ?? [];
    const visible = contributors.slice(0, 5);
    const overflow = Math.max(0, contributors.length - visible.length);
    if (visible.length === 0) {
      return null;
    }
    return (
      <div className="flex items-center">
        {visible.map((contributor, index) => (
          <div
            key={contributor.user_id}
            className="rounded-full ring-2 ring-surface"
            style={{ marginLeft: index === 0 ? 0 : -10, zIndex: visible.length - index }}
          >
            <UserProfileImage
              userId={contributor.user_id}
              sizePx={sizePx}
              alt={contributor.username}
              imageId={contributor.profile_image_id}
              imageAccessGrant={contributor.profile_image_access_grant}
            />
          </div>
        ))}
        {overflow > 0 ? (
          <span
            className="ml-2 rounded-full bg-border px-2 py-0.5 text-[11px] font-medium text-muted"
            style={{ marginLeft: 6 }}
          >
            +{overflow}
          </span>
        ) : null}
      </div>
    );
  };

  const renderHeroOpenCard = (item: SharedPostListItem) => {
    const sealedCount = sealedContributorCount(item);
    const progress =
      item.contributor_count > 0
        ? Math.min(100, Math.round((sealedCount / item.contributor_count) * 100))
        : 0;
    return (
      <div
        key={item.id}
        className="shared-event-hero"
        style={{ "--shared-event-progress": progress } as CSSProperties}
      >
        <div className="shared-event-hero-frost" aria-hidden />
        {item.is_creator ? (
          <button
            type="button"
            aria-label="Shared event settings"
            onClick={() => onOpenSettings(item.id)}
            className="absolute right-3 top-3 z-[1] rounded-full p-1.5 text-muted transition hover:bg-bg/40 hover:text-foreground"
          >
            <SettingsIcon className="h-4 w-4" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setView({ kind: "detail", sharedPostId: item.id })}
          className="relative z-[1] flex w-full flex-col items-center text-center"
        >
          <LockIcon className="h-7 w-7 text-foreground" strokeWidth={1.75} />
          <p className="mt-3 text-4xl font-bold tracking-tight text-accent">
            {formatCountdown(item.close_at)}
          </p>
          <p className="mt-2 text-lg font-semibold text-foreground">{item.title}</p>
          <p className="mt-1 text-xs text-muted">
            {sealedCount} of {item.contributor_count}{" "}
            {item.contributor_count === 1 ? "person has" : "people have"} contributed
          </p>
          <div className="mt-4 flex justify-center">{renderContributorAvatars(item)}</div>
        </button>
        {renderContributeButtons(item.id)}
      </div>
    );
  };

  const renderOpenGridCard = (item: SharedPostListItem) => (
    <div
      key={item.id}
      className="flex min-w-0 flex-col rounded-2xl border border-border bg-surface p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => setView({ kind: "detail", sharedPostId: item.id })}
          className="min-w-0 flex-1 text-left"
        >
          <p className="truncate text-sm font-semibold text-foreground">{item.title}</p>
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
            <ClockIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
            <span>{formatCountdown(item.close_at)}</span>
          </p>
        </button>
        {item.is_creator ? (
          <button
            type="button"
            aria-label="Shared event settings"
            onClick={() => onOpenSettings(item.id)}
            className="shrink-0 rounded-full p-1 text-muted transition hover:text-foreground"
          >
            <SettingsIcon className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {renderContributeButtons(item.id, true)}
    </div>
  );

  const renderPendingCard = (item: SharedPostListItem) => (
    <div
      key={item.id}
      className="flex items-stretch overflow-hidden rounded-2xl border border-border bg-surface"
    >
      <button
        type="button"
        onClick={() => setView({ kind: "detail", sharedPostId: item.id })}
        className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left transition hover:bg-bg/30"
      >
        <WaxSealIcon className="h-12 w-12 shrink-0" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{item.title}</p>
          <p className="mt-0.5 text-sm font-medium text-foreground">
            Releases {formatReleaseShort(item.release_at)}
          </p>
          <p className="mt-0.5 text-xs text-muted">Sealed until then</p>
        </div>
      </button>
      {item.is_creator ? (
        <button
          type="button"
          aria-label="Shared event settings"
          onClick={() => onOpenSettings(item.id)}
          className="flex shrink-0 items-center justify-center border-l border-border px-3 text-muted transition hover:bg-bg/40 hover:text-foreground"
        >
          <SettingsIcon className="h-5 w-5" />
        </button>
      ) : null}
    </div>
  );

  const renderReleasedRow = (item: SharedPostListItem) => (
    <div
      key={item.id}
      className="flex items-stretch overflow-hidden rounded-2xl border border-border bg-surface"
    >
      <button
        type="button"
        onClick={() => setView({ kind: "detail", sharedPostId: item.id })}
        className="min-w-0 flex-1 px-3 py-3 text-left transition hover:bg-bg/40"
      >
        <p className="truncate text-sm font-semibold text-foreground">{item.title}</p>
        <p className="mt-1 text-xs text-muted">Released {formatDateLabel(item.release_at)}</p>
      </button>
      {item.is_creator ? (
        <button
          type="button"
          aria-label="Shared event settings"
          onClick={() => onOpenSettings(item.id)}
          className="flex shrink-0 items-center justify-center border-l border-border px-3 text-muted transition hover:bg-bg/40 hover:text-foreground"
        >
          <SettingsIcon className="h-5 w-5" />
        </button>
      ) : null}
    </div>
  );

  const isSettingsEditor = editor?.kind === "settings";
  const editorModal =
    isMounted && (editor || isEditorClosing)
      ? createPortal(
          <div
            className={`${DONT_SWIPE_TABS_CLASSNAME} fixed inset-0 z-[2200] flex items-center justify-center px-3 ${
              isEditorClosing ? "pointer-events-none" : ""
            }`}
          >
            <div
              className={`${
                isEditorClosing ? "emoji-picker-backdrop-out" : "emoji-picker-backdrop-in"
              } absolute inset-0 bg-black/45 backdrop-blur-md`}
              onClick={closeEditor}
              aria-hidden="true"
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label={isSettingsEditor ? "Shared Event Settings" : "Create Shared Event"}
              className={`${
                isEditorClosing ? "emoji-picker-panel-out" : "emoji-picker-panel-in"
              } relative flex max-h-[min(85vh,720px)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-bg`}
              onClick={(event) => event.stopPropagation()}
            >
              <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold text-foreground">
                  {isSettingsEditor ? "Shared Event Settings" : "Create Shared Event"}
                </h2>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={closeEditor}
                  className="rounded-full p-1.5 text-muted transition hover:bg-surface hover:text-foreground"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </header>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
                {isSettingsEditor && isLoadingSettings ? (
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
                    <div className="overflow-hidden rounded-xl border border-border">
                      <div className="flex gap-3 px-3 py-3">
                        <div className="flex w-3 shrink-0 flex-col items-center pt-1.5" aria-hidden>
                          <span className="h-2.5 w-2.5 rounded-full bg-accent" />
                          <span className="mt-1 w-px flex-1 bg-border" />
                        </div>
                        <div className="min-w-0 flex-1 pb-1">
                          <EventDateTimeSelect
                            variant="inline"
                            label="Contribute until"
                            value={createCloseAt}
                            onChange={setCreateCloseAt}
                          />
                        </div>
                      </div>
                      <div className="flex gap-3 border-t border-border px-3 py-3">
                        <div className="flex w-3 shrink-0 flex-col items-center pt-1.5" aria-hidden>
                          <span className="h-2.5 w-2.5 rounded-full border-2 border-accent bg-bg" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <EventDateTimeSelect
                            variant="inline"
                            label="Reveal at"
                            value={createReleaseAt}
                            onChange={setCreateReleaseAt}
                          />
                        </div>
                      </div>
                    </div>

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
                                  <CheckIcon className="h-3.5 w-3.5" />
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
                      onClick={() =>
                        void (isSettingsEditor ? onSettingsSubmit() : onCreateSubmit())
                      }
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-accent bg-surface py-3 text-sm font-semibold text-accent disabled:opacity-50"
                    >
                      {isSavingEditor ? (
                        <Loader scale={0.55} />
                      ) : isSettingsEditor ? null : (
                        <AddIcon className="h-4 w-4" />
                      )}
                      {isSettingsEditor ? "Save" : "Create"}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  if (view.kind === "detail") {
    return (
      <div className="flex h-full min-h-0 flex-col bg-bg">
        {editorModal}
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
                      <AddImageIcon className="h-4 w-4" />
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

  const featuredOpen =
    openPosts.length === 0
      ? null
      : [...openPosts].sort((a, b) => a.close_at.localeCompare(b.close_at))[0] ?? null;
  const otherOpenPosts = featuredOpen
    ? openPosts.filter((item) => item.id !== featuredOpen.id)
    : [];

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      {editorModal}
      <header className="flex items-center justify-between gap-3 px-4 pb-1 pt-3">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="text-xl font-bold tracking-tight text-foreground">Shared Events</h1>
          <button
            type="button"
            onClick={() => {
              void onRefreshSharedEvents();
            }}
            disabled={isRefreshing}
            className="rounded-md p-0.5 text-muted transition hover:text-foreground disabled:opacity-80"
            aria-label="Refresh shared events"
          >
            <RefreshIcon
              className={`h-5 w-5 shrink-0 ${isRefreshing ? "animate-spin" : ""}`}
              aria-hidden
            />
          </button>
        </div>
        <button
          type="button"
          onClick={onOpenCreate}
          aria-label="Create Shared Event"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-foreground transition hover:border-accent hover:text-accent"
        >
          <AddIcon className="h-5 w-5" />
        </button>
      </header>

      <div
        ref={listContainerRef}
        className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 pt-3 space-y-5"
        onTouchStart={onListTouchStart}
        onTouchMove={onListTouchMove}
        onTouchEnd={resetPullGesture}
        onTouchCancel={resetPullGesture}
        onWheel={onListWheel}
      >
        {isLoading && !isRefreshing ? (
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-xs text-muted">
            <Loader />
            <span>Loading</span>
          </div>
        ) : null}

        {statusMessage ? <p className="text-xs text-muted">{statusMessage}</p> : null}

        {!isLoading && featuredOpen ? (
          <section>{renderHeroOpenCard(featuredOpen)}</section>
        ) : null}

        {!isLoading && openPosts.length === 0 && pendingPosts.length === 0 ? (
          <p className="py-2 text-center text-xs text-muted">
            No shared events yet. Create one to contribute blindly and reveal together.
          </p>
        ) : null}

        {otherOpenPosts.length > 0 ? (
          <section className="space-y-2.5">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
              Open
            </h2>
            <div className="grid grid-cols-2 gap-2.5">
              {otherOpenPosts.map((item) => renderOpenGridCard(item))}
            </div>
          </section>
        ) : null}

        {pendingPosts.length > 0 ? (
          <section className="space-y-2.5">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
              Waiting to Open
            </h2>
            <div className="space-y-2">{pendingPosts.map((item) => renderPendingCard(item))}</div>
          </section>
        ) : null}

        <section className="space-y-2.5">
          <button
            type="button"
            onClick={onToggleReleasedSection}
            aria-expanded={isReleasedExpanded}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
              Opened
            </h2>
            <ChevronDownIcon
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
              <p className="text-xs text-muted">No opened events yet.</p>
            ) : (
              <div className="space-y-2">
                {releasedPosts.map((item) => renderReleasedRow(item))}
              </div>
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
