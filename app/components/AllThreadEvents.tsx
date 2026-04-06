"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  const [showCreateName, setShowCreateName] = useState(false);
  const [createName, setCreateName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const loadEvents = useCallback(async () => {
    setIsLoading(true);
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
    } catch (error) {
      statusRef.current?.(error instanceof Error ? error.message : "Failed to load events.");
      setEvents([]);
    } finally {
      setIsLoading(false);
    }
  }, [threadId]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const wasInactiveRef = useRef(isActive === false);
  useEffect(() => {
    if (isActive === false) {
      wasInactiveRef.current = true;
      return;
    }
    if (wasInactiveRef.current) {
      wasInactiveRef.current = false;
      void loadEvents();
    }
  }, [isActive, loadEvents]);

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
        <h2 className="text-sm font-semibold text-foreground">Upcoming events</h2>
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

      <div className="flex w-full flex-col">
        {isLoading ? (
          <p className="px-3 py-3 text-xs text-accent-2">Loading events…</p>
        ) : null}
        {!isLoading && events.length === 0 ? (
          <p className="px-3 py-3 text-xs text-accent-2">No upcoming events.</p>
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
