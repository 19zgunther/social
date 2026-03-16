"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Thread from "@/app/components/Thread";
import { ApiError, GroupsListResponse, ThreadItem } from "@/app/types/interfaces";
import { readCacheValue, writeCacheValue } from "@/app/lib/cacheSystem";
import CachedImage from "./utils/CachedImage";
import { Image } from "lucide-react";

type GroupsProps = {
  currentUserId: string;
  onThreadRead?: () => void;
  deepLinkThreadId?: string | null;
  onDeepLinkThreadHandled?: () => void;
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
}: GroupsProps) {
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [selectedThread, setSelectedThread] = useState<ThreadItem | null>(null);
  const [unreadThreadIds, setUnreadThreadIds] = useState<Set<string>>(new Set());
  const [threadName, setThreadName] = useState("");
  const [isLoadingThreads, setIsLoadingThreads] = useState(true);
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
    }
  };

  const onOpenThread = useCallback((thread: ThreadItem) => {
    setSelectedThread(thread);
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

  if (selectedThread) {
    return (
      <Thread
        thread={selectedThread}
        currentUserId={currentUserId}
        onBack={() => {
          setSelectedThread(null);
          setStatusMessage("");
          void loadUnreadThreads();
        }}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col space-y-3 px-2">
      <div>
        <header className="flex items-center justify-between border-b border-accent-1 px-4 py-3">
          <h1 className="text-lg font-semibold text-foreground">Groups</h1>
        </header>
      </div>

      <form onSubmit={onCreateThread} className="flex items-center gap-2">
        <input
          className="flex-1 rounded-xl border border-accent-1 bg-primary-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent-2"
          placeholder="New thread name"
          value={threadName}
          onChange={(event) => setThreadName(event.target.value)}
          required
        />
        <button
          type="submit"
          disabled={isCreatingThread}
          className="rounded-xl bg-accent-3 px-4 py-2 text-xs font-semibold text-primary-background transition hover:brightness-110 disabled:opacity-60"
        >
          {isCreatingThread ? "Creating..." : "Create"}
        </button>
      </form>

      {isLoadingThreads ? (
        <div className="flex items-center gap-2 rounded-xl border border-accent-1 bg-primary-background px-3 py-2 text-xs text-accent-2">
          <span
            aria-hidden
            className="h-3 w-3 animate-spin rounded-full border-2 border-accent-2 border-t-transparent"
          />
          <span>Loading threads...</span>
        </div>
      ) : null}

      <div className="flex-1 min-h-0 space-y-2 overflow-y-auto overscroll-contain pr-1 touch-pan-y">
        {!isLoadingThreads && threads.length === 0 ? (
          <p className="text-xs text-accent-2">No threads yet. Create your first one.</p>
        ) : null}

        {threads.map((thread) => (
          <button
            key={thread.id}
            type="button"
            onClick={() => {
              onOpenThread(thread);
            }}
            className={`w-full rounded-xl border px-4 py-3 text-left transition ${unreadThreadIds.has(thread.id)
              ? "border-accent-3 bg-secondary-background"
              : "border-accent-1 bg-primary-background hover:border-accent-2"
              }`}
          >
            <div className="flex items-center gap-2">
              {thread.image_url ? (
                <CachedImage
                  signedUrl={thread.image_url}
                  imageId={thread.image_id ?? null}
                  alt="Group photo"
                  className="h-10 w-10 rounded-full border border-accent-1 object-cover"
                />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center">
                  <Image className="h-10 w-10 text-accent-2" />
                </div>
              )}

              <p className="text-sm font-medium text-foreground">{thread.name}</p>

              {unreadThreadIds.has(thread.id) ? (
                <span className="rounded-full border border-accent-3 px-2 py-0.5 text-[10px] font-semibold text-accent-3">
                  New
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-accent-2">Owner: {thread.owner_username}</p>
          </button>
        ))}
      </div>

      {statusMessage ? <p className="text-xs text-accent-2">{statusMessage}</p> : null}
    </div>
  );
}
