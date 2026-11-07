"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDownIcon, RefreshIcon } from "@/app/components/Icons";
import EventDateTimeSelect, { isoToEventLocalDatetime } from "@/app/components/EventDateTimeSelect";
import ThreadEventListRow from "@/app/components/ThreadEventListRow";
import { Button } from "@/app/ui-components";
import type {
  AcceptedFriend,
  ApiError,
  EventCreateRequest,
  EventCreateResponse,
  FriendRequestsListResponse,
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
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CLOSE_AFTER_DAYS = 3;
const DEFAULT_RELEASE_AFTER_DAYS = 7;

/** Local `YYYY-MM-DDTHH:mm` for now + N days. */
const localDatetimeInDays = (days: number): string =>
  isoToEventLocalDatetime(new Date(Date.now() + days * DAY_MS).toISOString());

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
  const [showCreateOptions, setShowCreateOptions] = useState(false);
  const [startsDraft, setStartsDraft] = useState("");
  const [endsDraft, setEndsDraft] = useState("");
  const [blindReveal, setBlindReveal] = useState(false);
  const [closeDraft, setCloseDraft] = useState("");
  const [releaseDraft, setReleaseDraft] = useState("");
  const [friends, setFriends] = useState<AcceptedFriend[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [friendsLoaded, setFriendsLoaded] = useState(false);
  const [inviteeIds, setInviteeIds] = useState<string[]>([]);
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

  const loadFriends = useCallback(async () => {
    setFriendsLoading(true);
    try {
      const response = await postWithAuth("/api/friend-requests-list", {});
      if (!response.ok) {
        setCreateError(await readErrorMessage(response));
        return;
      }
      const payload = (await response.json()) as FriendRequestsListResponse;
      setFriends(payload.accepted_friends);
      setFriendsLoaded(true);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Failed to load friends.");
    } finally {
      setFriendsLoading(false);
    }
  }, []);

  const onToggleCreateOptions = () => {
    const next = !showCreateOptions;
    setShowCreateOptions(next);
    if (next && !friendsLoaded && !friendsLoading) {
      void loadFriends();
    }
  };

  const onToggleBlindReveal = (checked: boolean) => {
    setBlindReveal(checked);
    if (checked) {
      setCloseDraft((previous) => previous || localDatetimeInDays(DEFAULT_CLOSE_AFTER_DAYS));
      setReleaseDraft((previous) => previous || localDatetimeInDays(DEFAULT_RELEASE_AFTER_DAYS));
    }
  };

  const onToggleInvitee = (userId: string) => {
    setInviteeIds((previous) =>
      previous.includes(userId) ? previous.filter((id) => id !== userId) : [...previous, userId],
    );
  };

  const resetCreateForm = () => {
    setCreateName("");
    setShowCreateOptions(false);
    setStartsDraft("");
    setEndsDraft("");
    setBlindReveal(false);
    setCloseDraft("");
    setReleaseDraft("");
    setInviteeIds([]);
  };

  const onCreateEvent = async () => {
    const name = createName.trim();
    if (!name || isCreating) {
      return;
    }

    const requestBody: EventCreateRequest = { name };
    if (startsDraft || endsDraft) {
      if (!startsDraft || !endsDraft) {
        setCreateError("Set both a start and an end, or leave both empty.");
        return;
      }
      const startsAt = new Date(startsDraft);
      const endsAt = new Date(endsDraft);
      if (endsAt <= startsAt) {
        setCreateError("End must be after start.");
        return;
      }
      requestBody.starts_at = startsAt.toISOString();
      requestBody.ends_at = endsAt.toISOString();
    }
    if (blindReveal) {
      if (!closeDraft || !releaseDraft) {
        setCreateError("Pick a close and release time for the surprise album.");
        return;
      }
      const closeAt = new Date(closeDraft);
      const releaseAt = new Date(releaseDraft);
      if (releaseAt <= closeAt) {
        setCreateError("Release must be after close.");
        return;
      }
      requestBody.blind_reveal = true;
      requestBody.close_at = closeAt.toISOString();
      requestBody.release_at = releaseAt.toISOString();
    }
    if (inviteeIds.length > 0) {
      requestBody.invitee_user_ids = inviteeIds;
    }

    setIsCreating(true);
    setCreateError("");
    try {
      const response = await postWithAuth("/api/event-create", requestBody);
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
      resetCreateForm();
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
            className="shrink-0 rounded-lg border border-white/20 p-1.5 text-muted transition hover:border-white/35 hover:text-white disabled:opacity-50"
            aria-label="Refresh events"
          >
            <RefreshIcon className={`h-4 w-4 ${refreshBusy ? "animate-spin" : ""}`} aria-hidden />
          </button>
        </div>
        <p className="mt-0.5 text-xs text-muted">Across all your groups</p>
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
          <Button
            type="button"
            variant="primary"
            size="sm"
            className="shrink-0"
            disabled={isCreating || !createName.trim()}
            onClick={() => {
              void onCreateEvent();
            }}
          >
            {isCreating ? "Creating..." : "Create"}
          </Button>
        </div>
        <button
          type="button"
          onClick={onToggleCreateOptions}
          className="mt-2 flex items-center gap-1 text-xs text-muted transition hover:text-white"
          aria-expanded={showCreateOptions}
        >
          <ChevronDownIcon
            className={`h-3.5 w-3.5 transition-transform ${showCreateOptions ? "rotate-180" : ""}`}
            aria-hidden
          />
          {showCreateOptions ? "Hide options" : "More options"}
        </button>
        {showCreateOptions ? (
          <div className="mt-2 max-h-[50vh] space-y-3 overflow-y-auto overscroll-contain rounded-lg border border-white/10 bg-black p-2.5">
            <div className="space-y-2">
              <EventDateTimeSelect
                variant="inline"
                label="Starts (optional)"
                value={startsDraft}
                onChange={setStartsDraft}
                disabled={isCreating}
              />
              <EventDateTimeSelect
                variant="inline"
                label="Ends (optional)"
                value={endsDraft}
                onChange={setEndsDraft}
                disabled={isCreating}
              />
              <p className="text-[11px] text-muted">Leave empty to start now for one hour.</p>
            </div>

            <div className="space-y-2 border-t border-white/10 pt-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-white">
                <input
                  type="checkbox"
                  checked={blindReveal}
                  disabled={isCreating}
                  onChange={(event) => onToggleBlindReveal(event.target.checked)}
                  className="h-4 w-4 accent-white"
                />
                Surprise album (blind until release)
              </label>
              {blindReveal ? (
                <div className="space-y-2">
                  <EventDateTimeSelect
                    variant="inline"
                    label="Uploads close"
                    value={closeDraft}
                    onChange={setCloseDraft}
                    disabled={isCreating}
                  />
                  <EventDateTimeSelect
                    variant="inline"
                    label="Album released"
                    value={releaseDraft}
                    onChange={setReleaseDraft}
                    disabled={isCreating}
                  />
                </div>
              ) : null}
            </div>

            <div className="space-y-2 border-t border-white/10 pt-3">
              <p className="text-xs font-medium text-muted">
                Invite friends{inviteeIds.length > 0 ? ` (${inviteeIds.length})` : ""}
              </p>
              {friendsLoading ? <p className="text-xs text-muted">Loading friends…</p> : null}
              {!friendsLoading && friendsLoaded && friends.length === 0 ? (
                <p className="text-xs text-muted">No friends to invite yet.</p>
              ) : null}
              <ul className="max-h-40 space-y-1 overflow-y-auto overscroll-contain">
                {friends.map((friend) => (
                  <li key={friend.user_id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm text-white hover:bg-white/5">
                      <input
                        type="checkbox"
                        checked={inviteeIds.includes(friend.user_id)}
                        disabled={isCreating}
                        onChange={() => onToggleInvitee(friend.user_id)}
                        className="h-4 w-4 accent-white"
                      />
                      <span className="min-w-0 flex-1 truncate">{friend.username}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
        {createError ? <p className="mt-1 text-xs text-muted">{createError}</p> : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-black">
        {isLoading ? (
          <p className="px-3 py-4 text-sm text-muted">Loading…</p>
        ) : null}
        {error && !isLoading ? <p className="px-3 py-3 text-sm text-muted">{error}</p> : null}
        {!isLoading && !error && items.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted">No upcoming events.</p>
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
