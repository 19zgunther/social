"use client";

import { FormEvent, TouchEvent, WheelEvent, useCallback, useEffect, useRef, useState } from "react";
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
import CachedImage from "./utils/CachedImage";
import { ArrowRight, Image, LoaderCircle, MessageCirclePlus, RefreshCw } from "lucide-react";
import { AppTab } from "./utils";

type GroupsProps = {
  currentUserId: string;
  onThreadRead?: () => void;
  deepLinkThreadId?: string | null;
  onDeepLinkThreadHandled?: () => void;
  selectedThread: ThreadItem | null;
  setSelectedThread: (thread: ThreadItem | null) => void;
  setActiveTab: (tab: AppTab) => void;
  isActiveTab: boolean;
  /** Increment to refetch the groups list (e.g. after a thread is deleted elsewhere). */
  groupsListRefreshNonce?: number;
};

const GROUPS_CACHE_KEY = "groups_list_v1";
const TOP_REFRESH_COOLDOWN_MS = 1500;
const PULL_REFRESH_THRESHOLD_PX = 55;

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
    signedUrl: string;
    imageId: string | null;
    imageOverlay: ImageOverlayData | null;
    replyToMessageId: string;
  } | null>(null);
  const [replyCamera, setReplyCamera] = useState<{
    threadId: string;
    replyToMessageId: string;
  } | null>(null);
  const [isReplyCameraSending, setIsReplyCameraSending] = useState(false);
  const groupsContainerRef = useRef<HTMLDivElement | null>(null);
  const pullStartYRef = useRef<number | null>(null);
  const pullRefreshTriggeredRef = useRef(false);
  const lastTopRefreshAtRef = useRef(0);

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
    }, 5_000);

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
      setSelectedThread(thread);
      setActiveTab("thread");
      markThreadRead(thread);
    },
    [markThreadRead],
  );

  const onLastMessagePreviewClick = useCallback(
    (thread: ThreadItem) => {
      markThreadRead(thread);
      const preview = thread.last_photo_preview;
      if (!preview) {
        return;
      }
      if (preview.image_url) {
        setGroupsPhotoViewer({
          threadId: thread.id,
          signedUrl: preview.image_url,
          imageId: preview.image_id,
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
    <div className="flex h-full min-h-0 flex-col space-y-3 px-2 bg-black">
      <div>
        <header className="flex items-center justify-between border-b border-accent-1 px-4 py-3">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-foreground">Groups</h1>
            {isLoadingThreads || isRefreshingList ? (
              <LoaderCircle
                className="h-5 w-5 shrink-0 animate-spin text-accent-2"
                aria-hidden
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  void onRefreshGroupsList();
                }}
                className="rounded-md p-0.5 text-accent-2 transition hover:text-foreground"
                aria-label="Refresh groups"
              >
                <RefreshCw className="h-5 w-5 shrink-0" aria-hidden />
              </button>
            )}
          </div>
          <button type="button" onClick={() => { setCreateThreadIsVisible(true); }}>
            <MessageCirclePlus className="h-6 w-6 text-accent-3" />
          </button>
        </header>
      </div>

      {createThreadIsVisible && <form onSubmit={onCreateThread} className="w-full block relative">
        <input
          className="flex-1 w-full rounded-xl border border-accent-1 bg-primary-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent-2"
          placeholder="New thread name"
          value={threadName}
          onChange={(event) => setThreadName(event.target.value)}
          required
        />
        <div className="flex items-center gap-2 mt-2">
          <button
            type="button"
            onClick={() => { setCreateThreadIsVisible(false); }}
            disabled={isCreatingThread}
            className="flex-1 rounded-xl bg-accent-3 px-4 py-2 text-xs font-semibold text-primary-background transition hover:brightness-110 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isCreatingThread}
            className="flex-1 rounded-xl bg-accent-3 px-4 py-2 text-xs font-semibold text-primary-background transition hover:brightness-110 disabled:opacity-60"
          >
            {isCreatingThread ? "Creating..." : "Create"}
          </button>
        </div>
      </form>}

      {isLoadingThreads ? (
        <div className="flex items-center gap-2 rounded-xl border border-accent-1 bg-primary-background px-3 py-2 text-xs text-accent-2">
          <span
            aria-hidden
            className="h-3 w-3 animate-spin rounded-full border-2 border-accent-2 border-t-transparent"
          />
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
          <p className="text-xs text-accent-2 px-4">No threads yet. Create your first one.</p>
        ) : null}

        {threads.map((thread) => (
          <GroupThreadRow
            key={thread.id}
            thread={thread}
            unreadThreadIds={unreadThreadIds}
            onOpenThread={onOpenThread}
            onLastMessagePreviewClick={onLastMessagePreviewClick}
          />
        ))}
      </div>

      {statusMessage ? <p className="text-xs text-accent-2">{statusMessage}</p> : null}

      <ImageViewerModal
        open={groupsPhotoViewer !== null}
        onClose={() => {
          setGroupsPhotoViewer(null);
        }}
        signedUrl={groupsPhotoViewer?.signedUrl ?? null}
        imageId={groupsPhotoViewer?.imageId ?? null}
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
  unreadThreadIds,
  onOpenThread,
  onLastMessagePreviewClick,
}: {
  thread: ThreadItem;
  unreadThreadIds: Set<string>;
  onOpenThread: (thread: ThreadItem) => void;
  onLastMessagePreviewClick: (thread: ThreadItem) => void;
}) {
  const preview = thread.last_photo_preview;
  const listTime = formatThreadListTime(thread.last_message_at);
  const hasPhotoPreview = Boolean(preview?.image_url);
  const isUnread = unreadThreadIds.has(thread.id);
  const showSelfLastArrow =
    !preview &&
    !isUnread &&
    thread.last_message_at &&
    thread.last_message_from_self === true;

  return (
    <button
      key={thread.id}
      type="button"
      onClick={() => {
        onOpenThread(thread);
      }}
      className={`relative w-full px-4 py-3 text-left transition border-b border-accent-1/30 ${isUnread
        ? "bg-secondary-background/50"
        : "bg-primary-background hover:bg-secondary-background/20"
        }`}
    >
      <div className="flex items-start gap-3">
        {thread.image_url ? (
          <CachedImage
            signedUrl={thread.image_url}
            imageId={thread.image_id ?? null}
            alt="Group photo"
            className="h-12 w-12 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-1/20 flex-shrink-0">
            <Image className="h-6 w-6 text-accent-2" />
          </div>
        )}

        <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-base font-semibold text-foreground">{thread.name}</p>
              {isUnread ? (
                <span
                  aria-label="Unread messages"
                  className="h-2 w-2 flex-shrink-0 rounded-full bg-accent-3"
                />
              ) : null}
            </div>
            <p className="mt-0.5 truncate text-sm text-accent-2">
              Members: {thread.participant_count ?? 1}
            </p>
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
                      ? "bg-red-600 shadow-sm ring-1 ring-red-500/40"
                      : "bg-blue-600 shadow-sm ring-1 ring-blue-500/40"
                    : hasPhotoPreview
                      ? "border-2 border-red-500/70 bg-transparent"
                      : "border-2 border-blue-500/70 bg-transparent"
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
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border-2 border-accent-2/80 bg-transparent text-accent-2"
              >
                <ArrowRight className="h-4 w-4" aria-hidden />
              </button>
            ) : null}

            {listTime ? <span className="text-xs text-accent-2">{listTime}</span> : null}
          </div>
        </div>
      </div>
    </button>
  );
}