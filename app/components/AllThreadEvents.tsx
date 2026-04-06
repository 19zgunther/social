"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import ThreadEventListRow from "@/app/components/ThreadEventListRow";
import type {
  ApiError,
  ThreadEventCreateResponse,
  ThreadEventItem,
  ThreadEventsListResponse,
} from "@/app/types/interfaces";

type AllThreadEventsProps = {
  threadId: string;
  currentUserId: string;
  onStatusMessage?: (message: string) => void;
  onOpenEvent: (event: ThreadEventItem) => void;
  onThreadEventCreated: (event: ThreadEventItem) => void;
  /** When false (e.g. event tab visible), list refetches when becoming true again. */
  isActive?: boolean;
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
    const data = (await response.json()) as ApiError;
    return data.error?.message ?? "Request failed.";
  } catch {
    return "Request failed.";
  }
};

const REFETCH_TTL_MS = 60_000;

type ThreadEventsSectionCacheEntry = {
  fetchedAt: number;
  events: ThreadEventItem[];
};

const threadEventsSectionCache = new Map<string, ThreadEventsSectionCacheEntry>();

function readFreshThreadEventsSection(threadId: string): ThreadEventItem[] | null {
  const row = threadEventsSectionCache.get(threadId);
  if (!row) {
    return null;
  }
  if (Date.now() - row.fetchedAt >= REFETCH_TTL_MS) {
    threadEventsSectionCache.delete(threadId);
    return null;
  }
  return row.events;
}

function writeThreadEventsSectionCache(threadId: string, events: ThreadEventItem[]) {
  threadEventsSectionCache.set(threadId, { fetchedAt: Date.now(), events });
}

export default function AllThreadEvents({
  threadId,
  currentUserId,
  onStatusMessage,
  onOpenEvent,
  onThreadEventCreated,
  isActive,
}: AllThreadEventsProps) {
  const statusRef = useRef(onStatusMessage);
  useEffect(() => {
    statusRef.current = onStatusMessage;
  }, [onStatusMessage]);

  const [events, setEvents] = useState<ThreadEventItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const eventsRef = useRef<ThreadEventItem[]>([]);
  const [showCreateName, setShowCreateName] = useState(false);
  const [createName, setCreateName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  const fetchEvents = useCallback(
    async (force: boolean) => {
      if (!force) {
        const cached = readFreshThreadEventsSection(threadId);
        if (cached) {
          setEvents(cached);
          setIsLoading(false);
          return;
        }
      }

      setRefreshBusy(true);
      if (eventsRef.current.length === 0) {
        setIsLoading(true);
      }
      setCreateError("");
      try {
        const response = await postWithAuth("/api/thread-events-list", { thread_id: threadId });
        if (!response.ok) {
          statusRef.current?.(await readErrorMessage(response));
          setEvents([]);
          return;
        }
        const payload = (await response.json()) as ThreadEventsListResponse;
        setEvents(payload.events);
        writeThreadEventsSectionCache(threadId, payload.events);
      } catch (error) {
        statusRef.current?.(error instanceof Error ? error.message : "Failed to load events.");
        setEvents([]);
      } finally {
        setRefreshBusy(false);
        setIsLoading(false);
      }
    },
    [threadId],
  );

  useEffect(() => {
    void fetchEvents(false);
  }, [threadId, fetchEvents]);

  const wasInactiveRef = useRef(isActive === false);
  useEffect(() => {
    if (isActive === false) {
      wasInactiveRef.current = true;
      return;
    }
    if (wasInactiveRef.current) {
      wasInactiveRef.current = false;
      void fetchEvents(false);
    }
  }, [isActive, fetchEvents]);

  const onCreate = async () => {
    const name = createName.trim();
    if (!name) {
      setCreateError("Enter a name.");
      return;
    }

    setIsCreating(true);
    setCreateError("");
    try {
      const response = await postWithAuth("/api/thread-event-create", {
        thread_id: threadId,
        name,
      });
      if (!response.ok) {
        setCreateError(await readErrorMessage(response));
        return;
      }
      const payload = (await response.json()) as ThreadEventCreateResponse;
      setCreateName("");
      setShowCreateName(false);
      threadEventsSectionCache.delete(threadId);
      onThreadEventCreated(payload.event);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to create event.");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-xl border border-accent-1 bg-secondary-background">
      <div className="flex items-center justify-between gap-2 border-b border-accent-1 px-3 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h2 className="truncate text-sm font-semibold text-foreground">Upcoming events</h2>
          <button
            type="button"
            disabled={refreshBusy}
            onClick={() => {
              void fetchEvents(true);
            }}
            className="shrink-0 rounded-lg border border-accent-1 p-1.5 text-accent-2 transition hover:border-accent-2 hover:text-foreground disabled:opacity-50"
            aria-label="Refresh events"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshBusy ? "animate-spin" : ""}`} aria-hidden />
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowCreateName((open) => !open);
            setCreateError("");
          }}
          className="shrink-0 rounded-xl border border-accent-1 px-3 py-1.5 text-xs font-semibold text-accent-2 transition hover:text-foreground"
        >
          {showCreateName ? "Cancel" : "Create"}
        </button>
      </div>

      {showCreateName ? (
        <form
          className="space-y-2 border-b border-accent-1 px-3 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            void onCreate();
          }}
        >
          <input
            type="text"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder="Event name"
            className="w-full rounded-xl border border-accent-1 bg-primary-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent-2"
            autoFocus
          />
          {createError ? <p className="text-xs text-accent-2">{createError}</p> : null}
          <button
            type="submit"
            disabled={isCreating}
            className="w-full rounded-xl bg-accent-3 px-3 py-2 text-xs font-semibold text-primary-background transition hover:brightness-110 disabled:opacity-60"
          >
            {isCreating ? "Creating…" : "Continue"}
          </button>
        </form>
      ) : null}

      <div className="flex w-full flex-col gap-3 px-3 pb-3">
        {isLoading ? (
          <p className="py-2 text-xs text-accent-2">Loading events…</p>
        ) : null}
        {!isLoading && events.length === 0 ? (
          <p className="py-2 text-xs text-accent-2">No upcoming events.</p>
        ) : null}
        {events.map((event) => (
          <ThreadEventListRow
            key={event.id}
            event={event}
            currentUserId={currentUserId}
            onOpen={() => onOpenEvent(event)}
          />
        ))}
      </div>
    </section>
  );
}
