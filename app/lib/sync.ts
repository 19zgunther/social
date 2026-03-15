import { randomUUID } from "node:crypto";

type SyncEventType = "thread_message_posted" | "thread_message_updated";

export type SyncEvent = {
  id: string;
  type: SyncEventType;
  created_at: number;
  thread_id: string;
  message_id: string;
  created_by: string;
};

type SyncHubState = {
  userQueues: Map<string, SyncEvent[]>;
  userWaiters: Map<string, Set<(events: SyncEvent[]) => void>>;
};

const globalSyncState = globalThis as unknown as { __syncHubState?: SyncHubState };

const state: SyncHubState =
  globalSyncState.__syncHubState ??
  (() => {
    const initialState: SyncHubState = {
      userQueues: new Map<string, SyncEvent[]>(),
      userWaiters: new Map<string, Set<(events: SyncEvent[]) => void>>(),
    };
    globalSyncState.__syncHubState = initialState;
    return initialState;
  })();

const MAX_QUEUE_LENGTH = 100;

const readQueuedEvents = (userId: string, maxEvents: number): SyncEvent[] => {
  const queue = state.userQueues.get(userId) ?? [];
  if (queue.length === 0) {
    return [];
  }

  const events = queue.slice(0, maxEvents);
  const remaining = queue.slice(maxEvents);

  if (remaining.length > 0) {
    state.userQueues.set(userId, remaining);
  } else {
    state.userQueues.delete(userId);
  }

  return events;
};

const notifyWaiters = (userId: string) => {
  const waiters = state.userWaiters.get(userId);
  if (!waiters || waiters.size === 0) {
    return;
  }

  state.userWaiters.delete(userId);
  const events = readQueuedEvents(userId, MAX_QUEUE_LENGTH);
  for (const resolve of waiters) {
    resolve(events);
  }
};

const publishThreadEvent = (
  eventType: SyncEventType,
  userIds: string[],
  payload: {
    thread_id: string;
    message_id: string;
    created_by: string;
  },
) => {
  const uniqueUserIds = Array.from(new Set(userIds));
  for (const userId of uniqueUserIds) {
    const queue = state.userQueues.get(userId) ?? [];
    queue.push({
      id: randomUUID(),
      type: eventType,
      created_at: Date.now(),
      thread_id: payload.thread_id,
      message_id: payload.message_id,
      created_by: payload.created_by,
    });

    if (queue.length > MAX_QUEUE_LENGTH) {
      queue.splice(0, queue.length - MAX_QUEUE_LENGTH);
    }

    state.userQueues.set(userId, queue);
    notifyWaiters(userId);
  }
};

export const publishThreadMessagePosted = (
  userIds: string[],
  payload: {
    thread_id: string;
    message_id: string;
    created_by: string;
  },
) => publishThreadEvent("thread_message_posted", userIds, payload);

export const publishThreadMessageUpdated = (
  userIds: string[],
  payload: {
    thread_id: string;
    message_id: string;
    created_by: string;
  },
) => publishThreadEvent("thread_message_updated", userIds, payload);

export const waitForUserSyncEvents = async (
  userId: string,
  options?: {
    timeoutMs?: number;
    maxEvents?: number;
  },
): Promise<SyncEvent[]> => {
  const timeoutMs = options?.timeoutMs ?? 25_000;
  const maxEvents = options?.maxEvents ?? 20;

  const immediateEvents = readQueuedEvents(userId, maxEvents);
  if (immediateEvents.length > 0) {
    return immediateEvents;
  }

  return new Promise<SyncEvent[]>((resolve) => {
    const resolver = (events: SyncEvent[]) => {
      clearTimeout(timeout);
      resolve(events.slice(0, maxEvents));
    };

    const existingWaiters = state.userWaiters.get(userId) ?? new Set();
    existingWaiters.add(resolver);
    state.userWaiters.set(userId, existingWaiters);

    const timeout = setTimeout(() => {
      const waiters = state.userWaiters.get(userId);
      if (waiters) {
        waiters.delete(resolver);
        if (waiters.size === 0) {
          state.userWaiters.delete(userId);
        }
      }
      resolve([]);
    }, timeoutMs);
  });
};
