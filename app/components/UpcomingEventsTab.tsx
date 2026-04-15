"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import ThreadEventListRow from "@/app/components/ThreadEventListRow";
import type {
  ApiError,
  EventCreateResponse,
  UserUpcomingEventListItem,
  UserUpcomingEventsResponse,
} from "@/app/types/interfaces";

type UpcomingEventsTabProps = {
  currentUserId: string;
  isActive: boolean;
  refreshNonce?: number;
  onOpenEvent: (item: UserUpcomingEventListItem) => void;
  onEventCreated: (item: UserUpcomingEventListItem) => void;
};

function formatEventRangeShort(startsAtIso: string, endsAtIso: string): string {
  try {
    const start = new Date(startsAtIso);
    const end = new Date(endsAtIso);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return "";
    }
    const dateOpts: Intl.DateTimeFormatOptions = {
      weekday: "short",
      month: "short",
      day: "numeric",
    };
    const timeOpts: Intl.DateTimeFormatOptions = {
      hour: "numeric",
      minute: "2-digit",
    };
    const sameDay = start.toDateString() === end.toDateString();
    const datePart = start.toLocaleString(undefined, dateOpts);
    const startT = start.toLocaleString(undefined, timeOpts);
    const endT = end.toLocaleString(undefined, timeOpts);
    if (sameDay) {
      return `${datePart} · ${startT} – ${endT}`;
    }
    return `${start.toLocaleString(undefined, { ...dateOpts, ...timeOpts })} → ${end.toLocaleString(undefined, { ...dateOpts, ...timeOpts })}`;
  } catch {
    return "";
  }
}

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

type UpcomingTabCacheEntry = {
  fetchedAt: number;
  items: UserUpcomingEventListItem[];
};

/** One global list per session (all groups). */
let upcomingEventsTabCache: UpcomingTabCacheEntry | null = null;

function readFreshUpcomingTabCache(): UserUpcomingEventListItem[] | null {
  if (!upcomingEventsTabCache) {
    return null;
  }
  if (Date.now() - upcomingEventsTabCache.fetchedAt >= REFETCH_TTL_MS) {
    upcomingEventsTabCache = null;
    return null;
  }
  return upcomingEventsTabCache.items;
}

function writeUpcomingTabCache(items: UserUpcomingEventListItem[]) {
  upcomingEventsTabCache = { fetchedAt: Date.now(), items };
}

export default function UpcomingEventsTab({
  currentUserId,
  isActive,
  refreshNonce = 0,
  onOpenEvent,
  onEventCreated,
}: UpcomingEventsTabProps) {
  const [items, setItems] = useState<UserUpcomingEventListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createError, setCreateError] = useState("");
  const [error, setError] = useState("");
  const itemsRef = useRef<UserUpcomingEventListItem[]>([]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const fetchUpcoming = useCallback(async (force: boolean) => {
    if (!force) {
      const cached = readFreshUpcomingTabCache();
      if (cached) {
        setItems(cached);
        setError("");
        setIsLoading(false);
        return;
      }
    }

    setRefreshBusy(true);
    if (itemsRef.current.length === 0) {
      setIsLoading(true);
    }
    setError("");
    try {
      const response = await postWithAuth("/api/user-upcoming-events", {});
      if (!response.ok) {
        setError(await readErrorMessage(response));
        setItems([]);
        return;
      }
      const payload = (await response.json()) as UserUpcomingEventsResponse;
      setItems(payload.items);
      writeUpcomingTabCache(payload.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load events.");
      setItems([]);
    } finally {
      setRefreshBusy(false);
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchUpcoming(false);
  }, [fetchUpcoming]);

  const wasInactiveRef = useRef(isActive === false);
  useEffect(() => {
    if (isActive === false) {
      wasInactiveRef.current = true;
      return;
    }
    if (wasInactiveRef.current) {
      wasInactiveRef.current = false;
      void fetchUpcoming(false);
    }
  }, [isActive, fetchUpcoming]);

  useEffect(() => {
    if (refreshNonce <= 0) {
      return;
    }
    void fetchUpcoming(true);
  }, [refreshNonce, fetchUpcoming]);

  const onCreateEvent = async () => {
    const name = createName.trim();
    if (!name || isCreating) {
      return;
    }
    setIsCreating(true);
    setCreateError("");
    try {
      const response = await postWithAuth("/api/event-create", { name });
      if (!response.ok) {
        setCreateError(await readErrorMessage(response));
        return;
      }
      const payload = (await response.json()) as EventCreateResponse;
      const createdItem: UserUpcomingEventListItem = {
        thread: payload.thread,
        event: payload.event,
      };
      setItems((previous) => [createdItem, ...previous]);
      writeUpcomingTabCache([createdItem, ...itemsRef.current]);
      setCreateName("");
      onEventCreated(createdItem);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Failed to create event.");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-black">
      <header className="shrink-0 border-b border-white/10 px-3 py-3">
        <div className="flex items-center gap-2">
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-white">Upcoming events</h1>
          <button
            type="button"
            disabled={refreshBusy}
            onClick={() => {
              void fetchUpcoming(true);
            }}
            className="shrink-0 rounded-lg border border-white/20 p-1.5 text-zinc-300 transition hover:border-white/35 hover:text-white disabled:opacity-50"
            aria-label="Refresh events"
          >
            <RefreshCw className={`h-4 w-4 ${refreshBusy ? "animate-spin" : ""}`} aria-hidden />
          </button>
        </div>
        <p className="mt-0.5 text-xs text-zinc-400">Across all your groups</p>
        <div className="mt-3 flex items-center gap-2">
          <input
            type="text"
            value={createName}
            onChange={(event) => {
              setCreateName(event.target.value);
              if (createError) {
                setCreateError("");
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void onCreateEvent();
              }
            }}
            placeholder="Event name"
            className="min-w-0 flex-1 rounded-lg border border-white/20 bg-black px-3 py-2 text-sm text-white outline-none focus:border-white/45"
          />
          <button
            type="button"
            disabled={isCreating || !createName.trim()}
            onClick={() => {
              void onCreateEvent();
            }}
            className="shrink-0 rounded-lg bg-accent-3 px-3 py-2 text-xs font-semibold text-primary-background transition hover:brightness-110 disabled:opacity-50"
          >
            {isCreating ? "Creating..." : "Create"}
          </button>
        </div>
        {createError ? <p className="mt-1 text-xs text-zinc-400">{createError}</p> : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-black">
        {isLoading ? (
          <p className="px-3 py-4 text-sm text-zinc-400">Loading…</p>
        ) : null}
        {error && !isLoading ? <p className="px-3 py-3 text-sm text-zinc-400">{error}</p> : null}
        {!isLoading && !error && items.length === 0 ? (
          <p className="px-3 py-4 text-sm text-zinc-400">No upcoming events.</p>
        ) : null}

        <div className="flex flex-col gap-3 px-3 pb-4 pt-2">
          {items.map(({ thread, event }) => {
            const when = formatEventRangeShort(event.starts_at, event.ends_at);
            const metaLine = when ? `${thread.name} · ${when}` : thread.name;
            return (
              <ThreadEventListRow
                key={event.id}
                event={event}
                currentUserId={currentUserId}
                metaLine={metaLine}
                onOpen={() => onOpenEvent({ thread, event })}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
