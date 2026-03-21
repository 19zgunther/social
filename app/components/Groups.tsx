"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Thread from "@/app/components/Thread";
import { ApiError, GroupsListResponse, ThreadItem } from "@/app/types/interfaces";
import { readCacheValue, writeCacheValue } from "@/app/lib/cacheSystem";
import CachedImage from "./utils/CachedImage";
import { Image, MessageCirclePlus, PencilIcon } from "lucide-react";
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
};

const GROUPS_CACHE_KEY = "groups_list_v1";

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

export default function Groups({
  currentUserId,
  onThreadRead,
  deepLinkThreadId,
  onDeepLinkThreadHandled,
  selectedThread,
  setSelectedThread,
  setActiveTab,
  isActiveTab,
}: GroupsProps) {
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [unreadThreadIds, setUnreadThreadIds] = useState<Set<string>>(new Set());
  const [threadName, setThreadName] = useState("");
  const [isLoadingThreads, setIsLoadingThreads] = useState(true);
  const [createThreadIsVisible, setCreateThreadIsVisible] = useState(false);
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

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

  const onOpenThread = useCallback((thread: ThreadItem) => {
    setSelectedThread(thread);
    setActiveTab("thread");
    setUnreadThreadIds((previous) => {
      const next = new Set(previous);
      next.delete(thread.id);
      return next;
    });
    void postWithAuth("/api/thread-mark-read", { thread_id: thread.id }).finally(() => {
      onThreadRead?.();
    });
  }, [onThreadRead]);

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
          <h1 className="text-lg font-semibold text-foreground">Groups</h1>
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

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y">
        {!isLoadingThreads && threads.length === 0 ? (
          <p className="text-xs text-accent-2 px-4">No threads yet. Create your first one.</p>
        ) : null}

        {threads.map((thread) => (
          <GroupThreadRow key={thread.id} thread={thread} unreadThreadIds={unreadThreadIds} onOpenThread={onOpenThread} />
        ))}
      </div>

      {statusMessage ? <p className="text-xs text-accent-2">{statusMessage}</p> : null}
    </div>
  );
}


function GroupThreadRow({
  thread,
  unreadThreadIds,
  onOpenThread
}: {
  thread: ThreadItem;
  unreadThreadIds: Set<string>;
  onOpenThread: (thread: ThreadItem) => void;
}) {
  return (
    <button
      key={thread.id}
      type="button"
      onClick={() => {
        onOpenThread(thread);
      }}
      className={`relative w-full px-4 py-3 text-left transition border-b border-accent-1/30 ${unreadThreadIds.has(thread.id)
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

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-base font-semibold text-foreground truncate">{thread.name}</p>
            <span className="text-xs text-accent-2 flex-shrink-0">Yesterday</span>
          </div>
          <p className="mt-0.5 text-sm text-accent-2 truncate">Owner: {thread.owner_username}</p>
        </div>
      </div>

      {unreadThreadIds.has(thread.id) ? (
        <div className="absolute right-4 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-accent-3" />
      ) : null}
    </button>
  );
}