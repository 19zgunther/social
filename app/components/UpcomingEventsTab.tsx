"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import EventEditorModal from "@/app/components/EventEditorModal";
import { ChevronDownIcon, ChevronRightIcon, NewEventIcon, RefreshIcon, SearchIcon } from "@/app/components/Icons";
import Loader from "@/app/components/Loader";
import ThreadEventListRow from "@/app/components/ThreadEventListRow";
import { useAnimatedModal } from "@/app/components/utils/AnimatedModal";
import type {
  ApiError,
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

function formatCompactEventTime(date: Date): string {
  const hour12 = date.getHours() % 12 || 12;
  const minutes = date.getMinutes();
  const suffix = date.getHours() < 12 ? "am" : "pm";
  return minutes === 0 ? `${hour12}${suffix}` : `${hour12}:${String(minutes).padStart(2, "0")}${suffix}`;
}

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
    const sameDay = start.toDateString() === end.toDateString();
    const datePart = start.toLocaleString(undefined, dateOpts);
    const startT = formatCompactEventTime(start);
    const endT = formatCompactEventTime(end);
    if (sameDay) {
      return `${datePart} from ${startT} to ${endT}`;
    }
    const endDatePart = end.toLocaleString(undefined, dateOpts);
    return `${datePart} ${startT} → ${endDatePart} ${endT}`;
  } catch {
    return "";
  }
}

function startsAtMs(item: UserUpcomingEventListItem): number {
  const ms = new Date(item.event.starts_at).getTime();
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

function insertUpcomingByStartsAt(
  items: UserUpcomingEventListItem[],
  createdItem: UserUpcomingEventListItem,
): UserUpcomingEventListItem[] {
  const next = [...items, createdItem];
  next.sort((a, b) => startsAtMs(a) - startsAtMs(b));
  return next;
}

function itemMatchesSearch(item: UserUpcomingEventListItem, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return true;
  }
  return (
    item.event.name.toLowerCase().includes(trimmed) ||
    item.thread.name.toLowerCase().includes(trimmed)
  );
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
let pastEventsTabCache: UpcomingTabCacheEntry | null = null;

function readFreshCache(cache: UpcomingTabCacheEntry | null): UserUpcomingEventListItem[] | null {
  if (!cache) {
    return null;
  }
  if (Date.now() - cache.fetchedAt >= REFETCH_TTL_MS) {
    return null;
  }
  return cache.items;
}

function writeUpcomingTabCache(items: UserUpcomingEventListItem[]) {
  upcomingEventsTabCache = { fetchedAt: Date.now(), items };
}

function writePastTabCache(items: UserUpcomingEventListItem[]) {
  pastEventsTabCache = { fetchedAt: Date.now(), items };
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
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState("");
  const [pastOpen, setPastOpen] = useState(false);
  const [pastItems, setPastItems] = useState<UserUpcomingEventListItem[]>([]);
  const [pastLoading, setPastLoading] = useState(false);
  const [pastError, setPastError] = useState("");
  const [pastLoaded, setPastLoaded] = useState(false);
  const itemsRef = useRef<UserUpcomingEventListItem[]>([]);
  const pastOpenRef = useRef(false);
  const {
    isPresented: isCreatePresented,
    isClosing: isCreateClosing,
    isActive: isCreateActive,
    open: openCreateModal,
    close: closeCreateModal,
  } = useAnimatedModal();

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    pastOpenRef.current = pastOpen;
  }, [pastOpen]);

  const fetchUpcoming = useCallback(async (force: boolean) => {
    if (!force) {
      const cached = readFreshCache(upcomingEventsTabCache);
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

  const fetchPast = useCallback(async (force: boolean) => {
    if (!force) {
      const cached = readFreshCache(pastEventsTabCache);
      if (cached) {
        setPastItems(cached);
        setPastError("");
        setPastLoaded(true);
        setPastLoading(false);
        return;
      }
    }

    setPastLoading(true);
    setPastError("");
    try {
      const response = await postWithAuth("/api/user-upcoming-events", { past: true });
      if (!response.ok) {
        setPastError(await readErrorMessage(response));
        setPastItems([]);
        setPastLoaded(true);
        return;
      }
      const payload = (await response.json()) as UserUpcomingEventsResponse;
      setPastItems(payload.items);
      writePastTabCache(payload.items);
      setPastLoaded(true);
    } catch (e) {
      setPastError(e instanceof Error ? e.message : "Failed to load old events.");
      setPastItems([]);
      setPastLoaded(true);
    } finally {
      setPastLoading(false);
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
      if (pastOpenRef.current) {
        void fetchPast(false);
      }
    }
  }, [isActive, fetchUpcoming, fetchPast]);

  useEffect(() => {
    if (refreshNonce <= 0) {
      return;
    }
    void fetchUpcoming(true);
    if (pastOpenRef.current) {
      void fetchPast(true);
    } else {
      pastEventsTabCache = null;
      setPastLoaded(false);
      setPastItems([]);
    }
  }, [refreshNonce, fetchUpcoming, fetchPast]);

  const onSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
  };

  const onRefreshClick = () => {
    void fetchUpcoming(true);
    if (pastOpen) {
      void fetchPast(true);
    } else {
      pastEventsTabCache = null;
      setPastLoaded(false);
      setPastItems([]);
    }
  };

  const onTogglePast = () => {
    const nextOpen = !pastOpen;
    setPastOpen(nextOpen);
    if (nextOpen && !pastLoaded) {
      void fetchPast(false);
    }
  };

  const onEventCreatedFromModal = (createdItem: UserUpcomingEventListItem) => {
    const nextItems = insertUpcomingByStartsAt(itemsRef.current, createdItem);
    setItems(nextItems);
    writeUpcomingTabCache(nextItems);
    onEventCreated(createdItem);
  };

  const filteredItems = items.filter((item) => itemMatchesSearch(item, searchQuery));
  const filteredPastItems = pastItems.filter((item) => itemMatchesSearch(item, searchQuery));
  const hasSearchQuery = searchQuery.trim().length > 0;
  const showEmptyCreateBlock = !isLoading && !error && items.length === 0;
  const showNoMatches =
    !isLoading && !error && items.length > 0 && filteredItems.length === 0 && hasSearchQuery;

  return (
    <div className="flex h-full min-h-0 flex-col space-y-3 bg-bg px-2">
      <div>
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-foreground">Events</h1>
            {isLoading || refreshBusy ? (
              <Loader scale={0.55} className="shrink-0" />
            ) : (
              <button
                type="button"
                onClick={onRefreshClick}
                className="rounded-md p-0.5 text-muted transition hover:text-foreground"
                aria-label="Refresh events"
              >
                <RefreshIcon className="h-5 w-5 shrink-0" aria-hidden />
              </button>
            )}
          </div>
          <button type="button" onClick={openCreateModal} aria-label="Create event">
            <NewEventIcon className="h-6 w-6 text-accent" aria-hidden />
          </button>
        </header>
      </div>

      <div className="relative mx-2">
        <SearchIcon
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
          aria-hidden
        />
        <input
          type="search"
          value={searchQuery}
          onChange={onSearchChange}
          placeholder="Search"
          className="w-full rounded-xl border border-border bg-surface py-2 pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted focus:border-muted"
          aria-label="Search events"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {isLoading ? (
          <p className="px-3 py-4 text-sm text-muted">Loading…</p>
        ) : null}
        {error && !isLoading ? <p className="px-3 py-3 text-sm text-muted">{error}</p> : null}

        {showEmptyCreateBlock ? (
          <div className="px-3 pb-4 pt-1">
            <button
              type="button"
              onClick={openCreateModal}
              className="create-post-rgb-border flex min-h-[40vw] w-full flex-col items-center justify-center gap-2 rounded-2xl px-4 py-10 font-semibold shadow-sm"
            >
              <span className="create-post-rgb-text text-3xl leading-none" aria-hidden>
                +
              </span>
              <span className="create-post-rgb-text text-base">Create a new event</span>
            </button>
          </div>
        ) : null}

        {showNoMatches ? (
          <p className="px-3 py-4 text-sm text-muted">No matching events.</p>
        ) : null}

        {!showEmptyCreateBlock ? (
          <div className="flex flex-col gap-3 px-3 pb-2 pt-1">
            {filteredItems.map(({ thread, event }) => {
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
        ) : null}

        {!isLoading ? (
          <div className="px-3 pb-4 pt-2">
            <button
              type="button"
              onClick={onTogglePast}
              className="flex w-full items-center gap-1.5 rounded-lg px-1 py-2 text-left text-sm font-medium text-muted transition hover:text-foreground"
              aria-expanded={pastOpen}
            >
              {pastOpen ? (
                <ChevronDownIcon className="h-4 w-4 shrink-0" aria-hidden />
              ) : (
                <ChevronRightIcon className="h-4 w-4 shrink-0" aria-hidden />
              )}
              See old events
            </button>

            {pastOpen ? (
              <div className="mt-1 space-y-3">
                {pastLoading ? <p className="px-1 py-2 text-sm text-muted">Loading old events…</p> : null}
                {pastError && !pastLoading ? (
                  <p className="px-1 py-2 text-sm text-muted">{pastError}</p>
                ) : null}
                {!pastLoading && !pastError && pastLoaded && filteredPastItems.length === 0 ? (
                  <p className="px-1 py-2 text-sm text-muted">
                    {hasSearchQuery ? "No matching old events." : "No old events yet."}
                  </p>
                ) : null}
                {!pastLoading && !pastError
                  ? filteredPastItems.map(({ thread, event }) => {
                      const when = formatEventRangeShort(event.starts_at, event.ends_at);
                      const metaLine = when ? `${thread.name} · ${when}` : thread.name;
                      return (
                        <ThreadEventListRow
                          key={`past-${event.id}`}
                          event={event}
                          currentUserId={currentUserId}
                          metaLine={metaLine}
                          onOpen={() => onOpenEvent({ thread, event })}
                        />
                      );
                    })
                  : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <EventEditorModal
        isPresented={isCreatePresented}
        isClosing={isCreateClosing}
        isActive={isCreateActive}
        onClose={closeCreateModal}
        mode="create"
        currentUserId={currentUserId}
        onCreated={onEventCreatedFromModal}
      />
    </div>
  );
}
