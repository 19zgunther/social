"use client";

import {
  FormEvent,
  TouchEvent,
  WheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  ApiError,
  GroupsListResponse,
  ImageOverlayData,
  MessageData,
  ThreadItem,
} from "@/app/types/interfaces";
import ImageViewerModal from "@/app/components/ImageViewerModal";
import CameraModal from "@/app/components/Camera";
import { prepareImageForUpload } from "@/app/components/utils/client_file_storage_utils";
import { readCacheValue, writeCacheValue } from "@/app/lib/cacheSystem";
import ThreadAvatar from "@/app/components/ThreadAvatar";
import {
  ForwardIcon,
  NewChatIcon,
  PinIcon,
  RefreshIcon,
  SearchIcon,
} from "@/app/components/Icons";
import Loader from "@/app/components/Loader";
import { Button, TextField } from "@/app/ui-components";
import { AppTab } from "./utils";

type GroupsProps = {
  currentUserId: string;
  onThreadRead?: () => void;
  deepLinkThreadId?: string | null;
  onDeepLinkThreadHandled?: () => void;
  selectedThread: ThreadItem | null;
  setSelectedThread: (thread: ThreadItem | null) => void;
  setActiveTab: (tab: AppTab) => void;
  onOpenThreadFromGroups?: () => void;
  isActiveTab: boolean;
  /** Increment to refetch the groups list (e.g. after a thread is deleted elsewhere). */
  groupsListRefreshNonce?: number;
};

const GROUPS_CACHE_KEY = "groups_list_v1";
const TOP_REFRESH_COOLDOWN_MS = 1500;
const PULL_REFRESH_THRESHOLD_PX = 55;
const PIN_LONG_PRESS_MS = 500;
const PIN_ACTIONS_OVERLAY_Z = 1950;
const PINNED_AVATAR_SIZE_PX = 72;

const threadMatchesSearch = (thread: ThreadItem, rawQuery: string): boolean => {
  const query = rawQuery.trim().toLowerCase();
  if (!query) {
    return true;
  }
  if (thread.name.toLowerCase().includes(query)) {
    return true;
  }
  return (thread.member_usernames ?? []).some((username) =>
    username.toLowerCase().includes(query),
  );
};

type GroupsCachePayload = {
  threads: ThreadItem[];
  cached_at: number;
};

const postWithAuth = async (path: string, body: unknown): Promise<Response> => {

  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
};

const clampOverlayYRatio = (value: number): number => {
  if (Number.isNaN(value)) {
    return 0.5;
  }
  return Math.min(0.9, Math.max(0.1, value));
};

const formatThreadListTime = (iso: string | null | undefined): string => {
  if (!iso) {
    return "";
  }
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  const now = new Date();
  if (parsed.toDateString() === now.toDateString()) {
    return parsed.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (parsed.toDateString() === yesterday.toDateString()) {
    return "Yesterday";
  }
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

export default function Groups({
  currentUserId,
  onThreadRead,
  deepLinkThreadId,
  onDeepLinkThreadHandled,
  selectedThread,
  setSelectedThread,
  setActiveTab,
  onOpenThreadFromGroups,
  isActiveTab,
  groupsListRefreshNonce = 0,
}: GroupsProps) {
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [unreadThreadIds, setUnreadThreadIds] = useState<Set<string>>(new Set());
  const [threadName, setThreadName] = useState("");
  const [isLoadingThreads, setIsLoadingThreads] = useState(true);
  const [isRefreshingList, setIsRefreshingList] = useState(false);
  const [createThreadIsVisible, setCreateThreadIsVisible] = useState(false);
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [groupsPhotoViewer, setGroupsPhotoViewer] = useState<{
    threadId: string;
    signedUrl: string | null;
    imageId: string | null;
    imageAccessGrant: string | null;
    imageStorageUserId: string | null;
    imageOverlay: ImageOverlayData | null;
    replyToMessageId: string;
  } | null>(null);
  const [replyCamera, setReplyCamera] = useState<{
    threadId: string;
    replyToMessageId: string;
  } | null>(null);
  const [isReplyCameraSending, setIsReplyCameraSending] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [pinActionThreadId, setPinActionThreadId] = useState<string | null>(null);
  const [isPinningThread, setIsPinningThread] = useState(false);
  const groupsContainerRef = useRef<HTMLDivElement | null>(null);
  const pullStartYRef = useRef<number | null>(null);
  const pullRefreshTriggeredRef = useRef(false);
  const lastTopRefreshAtRef = useRef(0);
  const pinLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinLongPressTriggeredRef = useRef(false);

  const readErrorMessage = async (response: Response): Promise<string> => {
    try {
      const body = (await response.json()) as ApiError;
      return body.error?.message ?? "Request failed.";
    } catch {
      return "Request failed.";
    }
  };

  const readGroupsCache = useCallback(async (): Promise<GroupsCachePayload | null> => {
    try {
      const cached = await readCacheValue<GroupsCachePayload>(GROUPS_CACHE_KEY);
      if (!cached || !Array.isArray(cached.threads)) {
        return null;
      }
      return cached;
    } catch {
      return null;
    }
  }, []);

  const writeGroupsCache = useCallback(async (threadsToCache: ThreadItem[]): Promise<void> => {
    try {
      await writeCacheValue(GROUPS_CACHE_KEY, {
        threads: threadsToCache,
        cached_at: Date.now(),
      } satisfies GroupsCachePayload);
    } catch {
      // Best effort only.
    }
  }, []);

  const loadUnreadThreads = useCallback(async () => {
    try {
      const response = await postWithAuth("/api/groups-unread-count", {});
      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as { unread_thread_ids?: string[] };
      setUnreadThreadIds(new Set(payload.unread_thread_ids ?? []));
    } catch {
      // Keep old unread indications on transient failures.
    }
  }, []);

  const refreshGroupsListSilent = useCallback(async () => {
    try {
      const response = await postWithAuth("/api/groups-list", {});
      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as GroupsListResponse;
      setThreads(payload.threads);
      void writeGroupsCache(payload.threads);
      void loadUnreadThreads();
    } catch {
      // Keep showing the last known list on transient failures.
    }
  }, [loadUnreadThreads, writeGroupsCache]);

  const onRefreshGroupsList = useCallback(async () => {
    setIsRefreshingList(true);
    setStatusMessage("");
    try {
      const response = await postWithAuth("/api/groups-list", {});
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }
      const payload = (await response.json()) as GroupsListResponse;
      setThreads(payload.threads);
      void writeGroupsCache(payload.threads);
      void loadUnreadThreads();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to refresh groups.");
    } finally {
      setIsRefreshingList(false);
    }
  }, [loadUnreadThreads, writeGroupsCache]);

  const triggerTopRefresh = useCallback(() => {
    const now = Date.now();
    if (
      isLoadingThreads ||
      isRefreshingList ||
      now - lastTopRefreshAtRef.current < TOP_REFRESH_COOLDOWN_MS
    ) {
      return;
    }
    lastTopRefreshAtRef.current = now;
    void onRefreshGroupsList();
  }, [isLoadingThreads, isRefreshingList, onRefreshGroupsList]);

  const onGroupsTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    pullStartYRef.current = event.touches[0]?.clientY ?? null;
    pullRefreshTriggeredRef.current = false;
  };

  const onGroupsTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    if (pullRefreshTriggeredRef.current) {
      return;
    }
    const startY = pullStartYRef.current;
    const currentY = event.touches[0]?.clientY;
    const container = groupsContainerRef.current;
    if (startY === null || currentY === undefined || !container) {
      return;
    }
    if (container.scrollTop > 0) {
      return;
    }
    const deltaY = currentY - startY;
    if (deltaY >= PULL_REFRESH_THRESHOLD_PX) {
      pullRefreshTriggeredRef.current = true;
      triggerTopRefresh();
    }
  };

  const resetPullGesture = () => {
    pullStartYRef.current = null;
    pullRefreshTriggeredRef.current = false;
  };

  const onGroupsWheel = (event: WheelEvent<HTMLDivElement>) => {
    const container = groupsContainerRef.current;
    if (!container) {
      return;
    }
    if (container.scrollTop <= 0 && event.deltaY < -30) {
      triggerTopRefresh();
    }
  };

  const prevIsActiveTab = useRef(isActiveTab);
  useEffect(() => {
    const becameActive = isActiveTab && !prevIsActiveTab.current;
    prevIsActiveTab.current = isActiveTab;
    if (!becameActive) {
      return;
    }
    void refreshGroupsListSilent();
  }, [isActiveTab, refreshGroupsListSilent]);

  useEffect(() => {
    if (groupsListRefreshNonce === 0) {
      return;
    }
    void refreshGroupsListSilent();
  }, [groupsListRefreshNonce, refreshGroupsListSilent]);

  useEffect(() => {
    if (!isActiveTab) {
      return;
    }

    let cancelled = false;
    const intervalId = window.setInterval(() => {
      if (cancelled) {
        return;
      }
      void refreshGroupsListSilent();
    }, 45_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isActiveTab, refreshGroupsListSilent]);

  useEffect(() => {
    const run = async () => {
      setIsLoadingThreads(true);
      setStatusMessage("");

      try {
        const cached = await readGroupsCache();
        if (cached) {
          setThreads(cached.threads);
          setIsLoadingThreads(false);
        }

        const response = await postWithAuth("/api/groups-list", {});
        if (!response.ok) {
          setStatusMessage(await readErrorMessage(response));
          setThreads([]);
          return;
        }

        const payload = (await response.json()) as GroupsListResponse;
        setThreads(payload.threads);
        void writeGroupsCache(payload.threads);
        void loadUnreadThreads();
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : "Failed to load groups.");
        setThreads([]);
      } finally {
        setIsLoadingThreads(false);
      }
    };

    void run();
  }, [loadUnreadThreads, readGroupsCache, writeGroupsCache]);

  useEffect(() => {
    if (selectedThread) {
      return;
    }

    let cancelled = false;
    const refreshUnread = async () => {
      if (cancelled) {
        return;
      }
      await loadUnreadThreads();
    };

    void refreshUnread();
    const intervalId = window.setInterval(() => {
      void refreshUnread();
    }, 7_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [loadUnreadThreads, selectedThread]);

  useEffect(() => {
    if (isActiveTab) {
      loadUnreadThreads();
    }
  }, [loadUnreadThreads, isActiveTab])

  const onCreateThread = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!threadName.trim()) {
      return;
    }

    setIsCreatingThread(true);
    setStatusMessage("");

    try {
      const response = await postWithAuth("/api/thread-create", { name: threadName });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }

      const payload = (await response.json()) as { thread: ThreadItem };
      setThreads((previous) => [payload.thread, ...previous]);
      setThreadName("");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to create thread.");
    } finally {
      setIsCreatingThread(false);
      setCreateThreadIsVisible(false);
    }
  };

  const markThreadRead = useCallback((thread: ThreadItem) => {
    setUnreadThreadIds((previous) => {
      const next = new Set(previous);
      next.delete(thread.id);
      return next;
    });
    void postWithAuth("/api/thread-mark-read", { thread_id: thread.id }).finally(() => {
      onThreadRead?.();
    });
  }, [onThreadRead]);

  const onOpenThread = useCallback(
    (thread: ThreadItem) => {
      onOpenThreadFromGroups?.();
      setSelectedThread(thread);
      setActiveTab("thread");
      markThreadRead(thread);
    },
    [markThreadRead, onOpenThreadFromGroups, setActiveTab, setSelectedThread],
  );

  const applyPinnedLocally = useCallback(
    (threadId: string, pinned: boolean) => {
      setThreads((previous) => {
        const next = previous.map((thread) =>
          thread.id === threadId ? { ...thread, user_pinned_thread: pinned } : thread,
        );
        void writeGroupsCache(next);
        return next;
      });
      if (selectedThread?.id === threadId) {
        setSelectedThread({ ...selectedThread, user_pinned_thread: pinned });
      }
    },
    [selectedThread, setSelectedThread, writeGroupsCache],
  );

  const setThreadPinned = useCallback(
    async (thread: ThreadItem, pinned: boolean) => {
      const previousPinned = thread.user_pinned_thread === true;
      if (previousPinned === pinned) {
        setPinActionThreadId(null);
        return;
      }

      setIsPinningThread(true);
      setStatusMessage("");
      applyPinnedLocally(thread.id, pinned);

      try {
        const response = await postWithAuth("/api/thread-pin", {
          thread_id: thread.id,
          pinned,
        });
        if (!response.ok) {
          applyPinnedLocally(thread.id, previousPinned);
          setStatusMessage(await readErrorMessage(response));
          return;
        }
        setPinActionThreadId(null);
      } catch (error) {
        applyPinnedLocally(thread.id, previousPinned);
        setStatusMessage(error instanceof Error ? error.message : "Failed to update pin.");
      } finally {
        setIsPinningThread(false);
      }
    },
    [applyPinnedLocally],
  );

  const clearPinLongPressTimer = () => {
    if (pinLongPressTimerRef.current !== null) {
      clearTimeout(pinLongPressTimerRef.current);
      pinLongPressTimerRef.current = null;
    }
  };

  const startPinLongPress = (threadId: string) => {
    clearPinLongPressTimer();
    pinLongPressTriggeredRef.current = false;
    pinLongPressTimerRef.current = setTimeout(() => {
      pinLongPressTriggeredRef.current = true;
      setPinActionThreadId(threadId);
      pinLongPressTimerRef.current = null;
    }, PIN_LONG_PRESS_MS);
  };

  const cancelPinLongPress = () => {
    clearPinLongPressTimer();
  };

  const filteredThreads = useMemo(
    () => threads.filter((thread) => threadMatchesSearch(thread, searchQuery)),
    [threads, searchQuery],
  );
  const pinnedThreads = useMemo(
    () => filteredThreads.filter((thread) => thread.user_pinned_thread === true),
    [filteredThreads],
  );
  const unpinnedThreads = useMemo(
    () => filteredThreads.filter((thread) => thread.user_pinned_thread !== true),
    [filteredThreads],
  );
  const pinActionThread = useMemo(
    () =>
      pinActionThreadId
        ? threads.find((thread) => thread.id === pinActionThreadId) ?? null
        : null,
    [pinActionThreadId, threads],
  );

  useEffect(() => {
    return () => {
      clearPinLongPressTimer();
    };
  }, []);

  const onLastMessagePreviewClick = useCallback(
    (thread: ThreadItem) => {
      markThreadRead(thread);
      const preview = thread.last_photo_preview;
      if (!preview) {
        return;
      }
      if (
        preview.image_id &&
        (preview.image_url ||
          (preview.image_access_grant && preview.image_storage_user_id))
      ) {
        setGroupsPhotoViewer({
          threadId: thread.id,
          signedUrl: preview.image_url,
          imageId: preview.image_id,
          imageAccessGrant: preview.image_access_grant ?? null,
          imageStorageUserId: preview.image_storage_user_id ?? null,
          imageOverlay: preview.image_overlay,
          replyToMessageId: preview.message_id,
        });
        return;
      }
      setReplyCamera({ threadId: thread.id, replyToMessageId: preview.message_id });
    },
    [markThreadRead],
  );

  const onSendPhotoReply = async (payload: {
    file: File;
    overlayText: string;
    overlayYRatio: number;
  }) => {
    if (!replyCamera) {
      return;
    }
    const { threadId, replyToMessageId } = replyCamera;
    setIsReplyCameraSending(true);
    setStatusMessage("");
    try {
      const prepared = await prepareImageForUpload(payload.file);
      const trimmedOverlay = payload.overlayText.trim();
      const messageData: MessageData | undefined =
        trimmedOverlay.length > 0
          ? {
              image_overlay: {
                text: trimmedOverlay,
                y_ratio: clampOverlayYRatio(payload.overlayYRatio),
              },
            }
          : undefined;

      const response = await postWithAuth("/api/thread-send", {
        thread_id: threadId,
        text: "",
        reply_to_message_id: replyToMessageId,
        image_base64_data: prepared.base64Data,
        image_mime_type: prepared.mimeType,
        ...(messageData ? { message_data: messageData } : {}),
      });

      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }

      await response.json();
      setReplyCamera(null);
      void refreshGroupsListSilent();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to send photo.");
    } finally {
      setIsReplyCameraSending(false);
    }
  };

  useEffect(() => {
    if (!deepLinkThreadId || isLoadingThreads || selectedThread) {
      return;
    }

    const match = threads.find((thread) => thread.id === deepLinkThreadId);
    if (!match) {
      return;
    }

    onOpenThread(match);
    onDeepLinkThreadHandled?.();
  }, [deepLinkThreadId, isLoadingThreads, onDeepLinkThreadHandled, onOpenThread, selectedThread, threads]);

  return (
    <div className="flex h-full min-h-0 flex-col space-y-3 px-2 bg-bg">
      <div>
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-foreground">Groups</h1>
            {isLoadingThreads || isRefreshingList ? (
              <Loader scale={0.55} className="shrink-0" />
            ) : (
              <button
                type="button"
                onClick={() => {
                  void onRefreshGroupsList();
                }}
                className="rounded-md p-0.5 text-muted transition hover:text-foreground"
                aria-label="Refresh groups"
              >
                <RefreshIcon className="h-5 w-5 shrink-0" aria-hidden />
              </button>
            )}
          </div>
          <button type="button" onClick={() => { setCreateThreadIsVisible(true); }}>
            <NewChatIcon className="h-6 w-6 text-accent" />
          </button>
        </header>
      </div>

      {createThreadIsVisible && <form onSubmit={onCreateThread} className="w-full block relative">
        <TextField
          className="flex-1"
          placeholder="New thread name"
          value={threadName}
          onChange={(event) => setThreadName(event.target.value)}
          required
        />
        <div className="flex items-center gap-2 mt-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="flex-1"
            onClick={() => { setCreateThreadIsVisible(false); }}
            disabled={isCreatingThread}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            className="flex-1"
            disabled={isCreatingThread}
          >
            {isCreatingThread ? "Creating..." : "Create"}
          </Button>
        </div>
      </form>}

      <div className="relative mx-2">
        <SearchIcon
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
          aria-hidden
        />
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search"
          className="w-full rounded-xl border border-border bg-surface py-2 pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted focus:border-muted"
          aria-label="Search groups"
        />
      </div>

      {isLoadingThreads ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-bg px-3 py-2 text-xs text-muted">
          <Loader scale={0.7} />
          <span>Loading threads...</span>
        </div>
      ) : null}

      <div
        ref={groupsContainerRef}
        onTouchStart={onGroupsTouchStart}
        onTouchMove={onGroupsTouchMove}
        onTouchEnd={resetPullGesture}
        onTouchCancel={resetPullGesture}
        onWheel={onGroupsWheel}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y"
      >
        {!isLoadingThreads && threads.length === 0 ? (
          <p className="text-xs text-muted px-4">No threads yet. Create your first one.</p>
        ) : null}

        {!isLoadingThreads && threads.length > 0 && filteredThreads.length === 0 ? (
          <p className="text-xs text-muted px-4">No groups match your search.</p>
        ) : null}

        {pinnedThreads.length > 0 ? (
          <div className="grid grid-cols-3 gap-x-2 gap-y-4 px-3 pb-4 pt-2">
            {pinnedThreads.map((thread) => {
              const isUnread = unreadThreadIds.has(thread.id);
              return (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => {
                    if (pinLongPressTriggeredRef.current) {
                      pinLongPressTriggeredRef.current = false;
                      return;
                    }
                    onOpenThread(thread);
                  }}
                  onMouseDown={() => startPinLongPress(thread.id)}
                  onMouseUp={cancelPinLongPress}
                  onMouseLeave={cancelPinLongPress}
                  onTouchStart={() => startPinLongPress(thread.id)}
                  onTouchEnd={cancelPinLongPress}
                  onTouchMove={cancelPinLongPress}
                  onTouchCancel={cancelPinLongPress}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setPinActionThreadId(thread.id);
                  }}
                  className="flex flex-col items-center gap-1.5 border-0 bg-transparent p-1 text-center"
                  aria-label={`Open ${thread.name}`}
                >
                  <div className="relative">
                    <ThreadAvatar
                      sizePx={PINNED_AVATAR_SIZE_PX}
                      threadId={thread.id}
                      imageId={thread.image_id}
                      imageUrl={thread.image_url}
                      imageAccessGrant={thread.image_access_grant}
                      memberUserIds={thread.member_user_ids}
                      currentUserId={currentUserId}
                      alt={`${thread.name} photo`}
                    />
                    {isUnread ? (
                      <span
                        aria-label="Unread messages"
                        className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-bg"
                      />
                    ) : null}
                  </div>
                  <p className="line-clamp-2 w-full text-xs font-medium text-foreground">
                    {thread.name}
                  </p>
                </button>
              );
            })}
          </div>
        ) : null}

        {unpinnedThreads.map((thread) => (
          <GroupThreadRow
            key={thread.id}
            thread={thread}
            currentUserId={currentUserId}
            unreadThreadIds={unreadThreadIds}
            onOpenThread={(nextThread) => {
              if (pinLongPressTriggeredRef.current) {
                pinLongPressTriggeredRef.current = false;
                return;
              }
              onOpenThread(nextThread);
            }}
            onLastMessagePreviewClick={onLastMessagePreviewClick}
            onLongPressStart={() => startPinLongPress(thread.id)}
            onLongPressCancel={cancelPinLongPress}
            onOpenPinActions={() => setPinActionThreadId(thread.id)}
          />
        ))}
      </div>

      {statusMessage ? <p className="text-xs text-muted">{statusMessage}</p> : null}

      {pinActionThread
        ? createPortal(
            <div
              className="fixed inset-0 flex items-end justify-center sm:items-center"
              style={{ zIndex: PIN_ACTIONS_OVERLAY_Z }}
              onClick={() => {
                if (!isPinningThread) {
                  setPinActionThreadId(null);
                }
              }}
            >
              <div className="absolute inset-0 bg-black/35 backdrop-blur-sm" aria-hidden />
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Chat actions"
                className="relative z-10 mb-6 w-[min(100%,22rem)] rounded-2xl border border-border bg-surface p-2 shadow-lg"
                onClick={(event) => event.stopPropagation()}
              >
                <p className="truncate px-3 py-2 text-sm font-semibold text-foreground">
                  {pinActionThread.name}
                </p>
                <button
                  type="button"
                  disabled={isPinningThread}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-3 text-left text-sm font-medium text-foreground hover:bg-bg disabled:opacity-60"
                  onClick={() => {
                    void setThreadPinned(
                      pinActionThread,
                      pinActionThread.user_pinned_thread !== true,
                    );
                  }}
                >
                  <PinIcon className="h-4 w-4 text-muted" aria-hidden />
                  {pinActionThread.user_pinned_thread === true ? "Unpin" : "Pin"}
                </button>
                <button
                  type="button"
                  disabled={isPinningThread}
                  className="mt-1 w-full rounded-xl px-3 py-2 text-sm text-muted hover:bg-bg disabled:opacity-60"
                  onClick={() => setPinActionThreadId(null)}
                >
                  Cancel
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}

      <ImageViewerModal
        open={groupsPhotoViewer !== null}
        onClose={() => {
          setGroupsPhotoViewer(null);
        }}
        signedUrl={groupsPhotoViewer?.signedUrl ?? null}
        imageId={groupsPhotoViewer?.imageId ?? null}
        imageAccessGrant={groupsPhotoViewer?.imageAccessGrant ?? null}
        imageStorageUserId={groupsPhotoViewer?.imageStorageUserId ?? null}
        imageOverlay={groupsPhotoViewer?.imageOverlay ?? null}
        onReply={() => {
          if (!groupsPhotoViewer) {
            return;
          }
          const { threadId, replyToMessageId } = groupsPhotoViewer;
          setGroupsPhotoViewer(null);
          setReplyCamera({ threadId, replyToMessageId });
        }}
      />

      <CameraModal
        isOpen={replyCamera !== null}
        onClose={() => {
          setReplyCamera(null);
        }}
        onSendPhoto={onSendPhotoReply}
        isSending={isReplyCameraSending}
        surfaceClassName="z-[2300]"
      />
    </div>
  );
}


function GroupThreadRow({
  thread,
  currentUserId,
  unreadThreadIds,
  onOpenThread,
  onLastMessagePreviewClick,
  onLongPressStart,
  onLongPressCancel,
  onOpenPinActions,
}: {
  thread: ThreadItem;
  currentUserId: string;
  unreadThreadIds: Set<string>;
  onOpenThread: (thread: ThreadItem) => void;
  onLastMessagePreviewClick: (thread: ThreadItem) => void;
  onLongPressStart: () => void;
  onLongPressCancel: () => void;
  onOpenPinActions: () => void;
}) {
  const preview = thread.last_photo_preview;
  const listTime = formatThreadListTime(thread.last_message_at);
  const hasPhotoPreview = Boolean(
    preview?.image_id &&
      (preview?.image_url ||
        (preview?.image_access_grant && preview?.image_storage_user_id)),
  );
  const isUnread = unreadThreadIds.has(thread.id);
  const showSelfLastArrow =
    !preview &&
    !isUnread &&
    thread.last_message_at &&
    thread.last_message_from_self === true;

  return (
    <div
      tabIndex={0}
      aria-label={`Open ${thread.name}`}
      onClick={() => {
        onOpenThread(thread);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenThread(thread);
        }
      }}
      onMouseDown={onLongPressStart}
      onMouseUp={onLongPressCancel}
      onMouseLeave={onLongPressCancel}
      onTouchStart={onLongPressStart}
      onTouchEnd={onLongPressCancel}
      onTouchMove={onLongPressCancel}
      onTouchCancel={onLongPressCancel}
      onContextMenu={(event) => {
        event.preventDefault();
        onOpenPinActions();
      }}
      className={`relative w-full cursor-pointer px-4 py-3 text-left transition border-b border-border/30 outline-none focus-visible:ring-2 focus-visible:ring-muted/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg ${isUnread
        ? "bg-surface/50"
        : "bg-bg hover:bg-surface/20"
        }`}
    >
      <div className="flex items-start gap-3">
        <ThreadAvatar
          sizePx={48}
          threadId={thread.id}
          imageId={thread.image_id}
          imageUrl={thread.image_url}
          imageAccessGrant={thread.image_access_grant}
          memberUserIds={thread.member_user_ids}
          currentUserId={currentUserId}
          alt={`${thread.name} photo`}
        />

        <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-base font-semibold text-foreground">
                {thread.name}
              </p>
              {isUnread ? (
                <span
                  aria-label="Unread messages"
                  className="h-2 w-2 flex-shrink-0 rounded-full bg-accent"
                />
              ) : null}
            </div>
            {thread.is_direct ? null : <p className="mt-0.5 truncate text-sm text-muted">
              Members: {thread.participant_count ?? 1}
            </p>}
          </div>

          <div className="flex flex-col flex-shrink-0 items-end gap-1 pt-0.5">
            {preview ? (
              <button
                type="button"
                aria-label={
                  hasPhotoPreview ? "View last photo message" : "Reply with photo to last message"
                }
                onClick={(event) => {
                  event.stopPropagation();
                  onLastMessagePreviewClick(thread);
                }}
                className={`h-8 w-8 flex-shrink-0 rounded-md ${
                  isUnread
                    ? hasPhotoPreview
                      ? "bg-danger-fill shadow-sm ring-1 ring-danger/40"
                      : "bg-accent shadow-sm ring-1 ring-accent/40"
                    : hasPhotoPreview
                      ? "border-2 border-danger/70 bg-transparent"
                      : "border-2 border-accent/70 bg-transparent"
                }`}
              />
            ) : showSelfLastArrow ? (
              <button
                type="button"
                aria-label="Open thread"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenThread(thread);
                }}
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border-2 border-muted/80 bg-transparent text-muted"
              >
                <ForwardIcon className="h-4 w-4" aria-hidden />
              </button>
            ) : null}

            {listTime ? <span className="text-xs text-muted">{listTime}</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}