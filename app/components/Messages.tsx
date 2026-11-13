"use client";

import {
  TouchEvent,
  WheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ApiError,
  FriendSearchResponse,
  MessagesListResponse,
  ThreadItem,
} from "@/app/types/interfaces";
import { readCacheValue, writeCacheValue } from "@/app/lib/cacheSystem";
import ThreadAvatar from "@/app/components/ThreadAvatar";
import {
  CloseIcon,
  NewChatIcon,
  RefreshIcon,
  SearchIcon,
} from "@/app/components/Icons";
import Loader from "@/app/components/Loader";
import MessagesThreadOptionsMenu from "@/app/components/MessagesThreadOptionsMenu";
import UserProfileImage from "@/app/components/UserProfileImage";
import UserSearch, { UserSearchOption } from "@/app/components/UserSearch";
import AnimatedModal, { useAnimatedModal } from "@/app/components/utils/AnimatedModal";
import { Button, IconButton, TextField } from "@/app/ui-components";
import { AppTab } from "./utils";

type MessagesProps = {
  currentUserId: string;
  onThreadRead?: () => void;
  deepLinkThreadId?: string | null;
  onDeepLinkThreadHandled?: () => void;
  selectedThread: ThreadItem | null;
  setSelectedThread: (thread: ThreadItem | null) => void;
  setActiveTab: (tab: AppTab) => void;
  onOpenThreadFromMessages?: () => void;
  isActiveTab: boolean;
  /** Increment to refetch the messages list (e.g. after a thread is deleted elsewhere). */
  messagesListRefreshNonce?: number;
};

const MESSAGES_CACHE_KEY = "messages_list_v1";
/** Pre-rebrand cache key; read once as a fallback, then rewritten under `MESSAGES_CACHE_KEY`. */
const LEGACY_GROUPS_CACHE_KEY = "groups_list_v1";
const TOP_REFRESH_COOLDOWN_MS = 1500;
const PULL_REFRESH_THRESHOLD_PX = 55;
const PIN_LONG_PRESS_MS = 500;
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

type MessagesCachePayload = {
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

export default function Messages({
  currentUserId,
  onThreadRead,
  deepLinkThreadId,
  onDeepLinkThreadHandled,
  selectedThread,
  setSelectedThread,
  setActiveTab,
  onOpenThreadFromMessages,
  isActiveTab,
  messagesListRefreshNonce = 0,
}: MessagesProps) {
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [unreadThreadIds, setUnreadThreadIds] = useState<Set<string>>(new Set());
  const [createChatTitle, setCreateChatTitle] = useState("");
  const [createChatSearchQuery, setCreateChatSearchQuery] = useState("");
  const [createChatSelectedMembers, setCreateChatSelectedMembers] = useState<UserSearchOption[]>(
    [],
  );
  const [createChatError, setCreateChatError] = useState("");
  const [isLoadingThreads, setIsLoadingThreads] = useState(true);
  const [isRefreshingList, setIsRefreshingList] = useState(false);
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const {
    isPresented: isCreateChatPresented,
    isClosing: isCreateChatClosing,
    open: openCreateChatModal,
    close: closeCreateChatModal,
    dismiss: dismissCreateChatModal,
  } = useAnimatedModal();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFriendSuggestions, setSearchFriendSuggestions] = useState<UserSearchOption[]>([]);
  const [isLoadingSearchFriends, setIsLoadingSearchFriends] = useState(false);
  const [openingDirectChatUserId, setOpeningDirectChatUserId] = useState<string | null>(null);
  const [optionsMenu, setOptionsMenu] = useState<{
    threadId: string;
    anchorEl: HTMLElement;
  } | null>(null);
  const [isPinningThread, setIsPinningThread] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const pullStartYRef = useRef<number | null>(null);
  const pullRefreshTriggeredRef = useRef(false);
  const lastTopRefreshAtRef = useRef(0);
  const pinLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinLongPressTriggeredRef = useRef(false);
  /** Suppress browser context menu after long-press opens our options menu. */
  const suppressBrowserContextMenuUntilRef = useRef(0);

  const readErrorMessage = async (response: Response): Promise<string> => {
    try {
      const body = (await response.json()) as ApiError;
      return body.error?.message ?? "Request failed.";
    } catch {
      return "Request failed.";
    }
  };

  const readMessagesCache = useCallback(async (): Promise<MessagesCachePayload | null> => {
    try {
      const cached = await readCacheValue<MessagesCachePayload>(MESSAGES_CACHE_KEY);
      if (cached && Array.isArray(cached.threads)) {
        return cached;
      }
      const legacy = await readCacheValue<MessagesCachePayload>(LEGACY_GROUPS_CACHE_KEY);
      if (legacy && Array.isArray(legacy.threads)) {
        return legacy;
      }
      return null;
    } catch {
      return null;
    }
  }, []);

  const writeMessagesCache = useCallback(async (threadsToCache: ThreadItem[]): Promise<void> => {
    try {
      await writeCacheValue(MESSAGES_CACHE_KEY, {
        threads: threadsToCache,
        cached_at: Date.now(),
      } satisfies MessagesCachePayload);
    } catch {
      // Best effort only.
    }
  }, []);

  const loadUnreadThreads = useCallback(async () => {
    try {
      const response = await postWithAuth("/api/messages-unread-count", {});
      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as { unread_thread_ids?: string[] };
      setUnreadThreadIds(new Set(payload.unread_thread_ids ?? []));
    } catch {
      // Keep old unread indications on transient failures.
    }
  }, []);

  const refreshMessagesListSilent = useCallback(async () => {
    try {
      const response = await postWithAuth("/api/messages-list", {});
      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as MessagesListResponse;
      setThreads(payload.threads);
      void writeMessagesCache(payload.threads);
      void loadUnreadThreads();
    } catch {
      // Keep showing the last known list on transient failures.
    }
  }, [loadUnreadThreads, writeMessagesCache]);

  const onRefreshMessagesList = useCallback(async () => {
    setIsRefreshingList(true);
    setStatusMessage("");
    try {
      const response = await postWithAuth("/api/messages-list", {});
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }
      const payload = (await response.json()) as MessagesListResponse;
      setThreads(payload.threads);
      void writeMessagesCache(payload.threads);
      void loadUnreadThreads();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to refresh messages.");
    } finally {
      setIsRefreshingList(false);
    }
  }, [loadUnreadThreads, writeMessagesCache]);

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
    void onRefreshMessagesList();
  }, [isLoadingThreads, isRefreshingList, onRefreshMessagesList]);

  const onMessagesTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    pullStartYRef.current = event.touches[0]?.clientY ?? null;
    pullRefreshTriggeredRef.current = false;
  };

  const onMessagesTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    if (pullRefreshTriggeredRef.current) {
      return;
    }
    const startY = pullStartYRef.current;
    const currentY = event.touches[0]?.clientY;
    const container = messagesContainerRef.current;
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

  const onMessagesWheel = (event: WheelEvent<HTMLDivElement>) => {
    const container = messagesContainerRef.current;
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
    void refreshMessagesListSilent();
  }, [isActiveTab, refreshMessagesListSilent]);

  useEffect(() => {
    if (messagesListRefreshNonce === 0) {
      return;
    }
    void refreshMessagesListSilent();
  }, [messagesListRefreshNonce, refreshMessagesListSilent]);

  useEffect(() => {
    if (!isActiveTab) {
      return;
    }

    let cancelled = false;
    const intervalId = window.setInterval(() => {
      if (cancelled) {
        return;
      }
      void refreshMessagesListSilent();
    }, 45_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isActiveTab, refreshMessagesListSilent]);

  useEffect(() => {
    const run = async () => {
      setIsLoadingThreads(true);
      setStatusMessage("");

      try {
        const cached = await readMessagesCache();
        if (cached) {
          setThreads(cached.threads);
          setIsLoadingThreads(false);
        }

        const response = await postWithAuth("/api/messages-list", {});
        if (!response.ok) {
          setStatusMessage(await readErrorMessage(response));
          setThreads([]);
          return;
        }

        const payload = (await response.json()) as MessagesListResponse;
        setThreads(payload.threads);
        void writeMessagesCache(payload.threads);
        void loadUnreadThreads();
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : "Failed to load messages.");
        setThreads([]);
      } finally {
        setIsLoadingThreads(false);
      }
    };

    void run();
  }, [loadUnreadThreads, readMessagesCache, writeMessagesCache]);

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

  const resetCreateChatState = useCallback(() => {
    setCreateChatTitle("");
    setCreateChatSearchQuery("");
    setCreateChatSelectedMembers([]);
    setCreateChatError("");
  }, []);

  const onOpenCreateChat = useCallback(
    (preselectedMembers?: UserSearchOption[]) => {
      resetCreateChatState();
      if (preselectedMembers && preselectedMembers.length > 0) {
        setCreateChatSelectedMembers(preselectedMembers);
      }
      openCreateChatModal();
    },
    [openCreateChatModal, resetCreateChatState],
  );

  const onCloseCreateChat = useCallback(() => {
    if (isCreatingThread) {
      return;
    }
    closeCreateChatModal({
      onClosed: resetCreateChatState,
    });
  }, [closeCreateChatModal, isCreatingThread, resetCreateChatState]);

  const searchCreateChatMembers = useCallback(
    async (query: string): Promise<UserSearchOption[]> => {
      try {
        const response = await postWithAuth("/api/friend-search", {
          query: query.trim() || undefined,
        });
        if (!response.ok) {
          return [];
        }
        const payload = (await response.json()) as FriendSearchResponse;
        const selectedIds = new Set(createChatSelectedMembers.map((member) => member.id));
        return payload.users
          .filter((user) => user.id !== currentUserId && !selectedIds.has(user.id))
          .map((user) => {
            const relation = user.relation;
            const friendshipStatus: UserSearchOption["friendshipStatus"] = relation
              ? relation.accepted === true
                ? "friends"
                : relation.accepted === false
                  ? "rejected"
                  : relation.direction === "incoming"
                    ? "pending_received"
                    : "pending_sent"
              : "none";
            const hint =
              friendshipStatus === "friends"
                ? "Friends"
                : friendshipStatus === "pending_sent"
                  ? "Pending request"
                  : friendshipStatus === "pending_received"
                    ? "Incoming request"
                    : "Not friends";
            return {
              id: user.id,
              username: user.username,
              email: user.email,
              hint,
              friendshipStatus,
            };
          });
      } catch {
        return [];
      }
    },
    [createChatSelectedMembers, currentUserId],
  );

  const onSelectCreateChatMember = useCallback((option: UserSearchOption) => {
    setCreateChatSelectedMembers((previous) => {
      if (previous.some((member) => member.id === option.id)) {
        return previous;
      }
      return [...previous, option];
    });
    setCreateChatSearchQuery("");
    setCreateChatError("");
  }, []);

  const onRemoveCreateChatMember = useCallback((userId: string) => {
    setCreateChatSelectedMembers((previous) =>
      previous.filter((member) => member.id !== userId),
    );
  }, []);

  const onCreateThread = async () => {
    const name = createChatTitle.trim();
    if (!name || isCreatingThread) {
      return;
    }

    setIsCreatingThread(true);
    setCreateChatError("");
    setStatusMessage("");

    try {
      const response = await postWithAuth("/api/thread-create", {
        name,
        member_user_ids: createChatSelectedMembers.map((member) => member.id),
      });
      if (!response.ok) {
        setCreateChatError(await readErrorMessage(response));
        return;
      }

      const payload = (await response.json()) as { thread: ThreadItem };
      setThreads((previous) => [payload.thread, ...previous]);
      dismissCreateChatModal();
      resetCreateChatState();
    } catch (error) {
      setCreateChatError(error instanceof Error ? error.message : "Failed to create thread.");
    } finally {
      setIsCreatingThread(false);
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
      onOpenThreadFromMessages?.();
      setSelectedThread(thread);
      setActiveTab("thread");
      markThreadRead(thread);
    },
    [markThreadRead, onOpenThreadFromMessages, setActiveTab, setSelectedThread],
  );

  const onOpenDirectChatWithFriend = useCallback(
    async (friend: UserSearchOption) => {
      if (openingDirectChatUserId) {
        return;
      }

      setOpeningDirectChatUserId(friend.id);
      setStatusMessage("");
      try {
        const response = await postWithAuth("/api/thread-direct-open", {
          other_user_id: friend.id,
        });
        if (!response.ok) {
          setStatusMessage(await readErrorMessage(response));
          return;
        }

        const payload = (await response.json()) as { thread: ThreadItem };
        setThreads((previous) => {
          if (previous.some((thread) => thread.id === payload.thread.id)) {
            return previous;
          }
          return [payload.thread, ...previous];
        });
        setSearchQuery("");
        setSearchFriendSuggestions([]);
        onOpenThread(payload.thread);
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : "Could not open message thread.",
        );
      } finally {
        setOpeningDirectChatUserId(null);
      }
    },
    [onOpenThread, openingDirectChatUserId],
  );

  const applyPinnedLocally = useCallback(
    (threadId: string, pinned: boolean) => {
      setThreads((previous) => {
        const next = previous.map((thread) =>
          thread.id === threadId ? { ...thread, user_pinned_thread: pinned } : thread,
        );
        void writeMessagesCache(next);
        return next;
      });
      if (selectedThread?.id === threadId) {
        setSelectedThread({ ...selectedThread, user_pinned_thread: pinned });
      }
    },
    [selectedThread, setSelectedThread, writeMessagesCache],
  );

  const closeOptionsMenu = useCallback(() => {
    if (isPinningThread) {
      return;
    }
    setOptionsMenu(null);
  }, [isPinningThread]);

  const openOptionsMenu = useCallback((threadId: string, anchorEl: HTMLElement) => {
    // Browser often fires `contextmenu` right after a long-press; block it briefly.
    suppressBrowserContextMenuUntilRef.current = Date.now() + 1500;
    setOptionsMenu({ threadId, anchorEl });
  }, []);

  const setThreadPinned = useCallback(
    async (thread: ThreadItem, pinned: boolean) => {
      const previousPinned = thread.user_pinned_thread === true;
      if (previousPinned === pinned) {
        setOptionsMenu(null);
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
        setOptionsMenu(null);
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

  const startPinLongPress = (threadId: string, target: HTMLElement) => {
    clearPinLongPressTimer();
    pinLongPressTriggeredRef.current = false;
    pinLongPressTimerRef.current = setTimeout(() => {
      pinLongPressTriggeredRef.current = true;
      openOptionsMenu(threadId, target);
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

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query || filteredThreads.length > 0) {
      setSearchFriendSuggestions([]);
      setIsLoadingSearchFriends(false);
      return;
    }

    let cancelled = false;
    setIsLoadingSearchFriends(true);

    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await postWithAuth("/api/friend-search", { query });
          if (!response.ok || cancelled) {
            if (!cancelled) {
              setSearchFriendSuggestions([]);
            }
            return;
          }
          const payload = (await response.json()) as FriendSearchResponse;
          if (cancelled) {
            return;
          }
          const suggestions = payload.users
            .filter(
              (user) => user.id !== currentUserId && user.relation?.accepted === true,
            )
            .map((user) => ({
              id: user.id,
              username: user.username,
              email: user.email,
              hint: "Friends",
              friendshipStatus: "friends" as const,
            }));
          setSearchFriendSuggestions(suggestions);
        } catch {
          if (!cancelled) {
            setSearchFriendSuggestions([]);
          }
        } finally {
          if (!cancelled) {
            setIsLoadingSearchFriends(false);
          }
        }
      })();
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [currentUserId, filteredThreads.length, searchQuery]);
  const pinnedThreads = useMemo(
    () => filteredThreads.filter((thread) => thread.user_pinned_thread === true),
    [filteredThreads],
  );
  const unpinnedThreads = useMemo(
    () => filteredThreads.filter((thread) => thread.user_pinned_thread !== true),
    [filteredThreads],
  );
  const optionsMenuThread = useMemo(
    () =>
      optionsMenu
        ? threads.find((thread) => thread.id === optionsMenu.threadId) ?? null
        : null,
    [optionsMenu, threads],
  );

  useEffect(() => {
    return () => {
      clearPinLongPressTimer();
    };
  }, []);

  useEffect(() => {
    const onContextMenuCapture = (event: Event) => {
      if (optionsMenu || Date.now() < suppressBrowserContextMenuUntilRef.current) {
        event.preventDefault();
      }
    };
    document.addEventListener("contextmenu", onContextMenuCapture, true);
    return () => {
      document.removeEventListener("contextmenu", onContextMenuCapture, true);
    };
  }, [optionsMenu]);

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
            <h1 className="text-lg font-semibold text-foreground">Messages</h1>
            {isLoadingThreads || isRefreshingList ? (
              <Loader scale={0.55} className="shrink-0" />
            ) : (
              <button
                type="button"
                onClick={() => {
                  void onRefreshMessagesList();
                }}
                className="rounded-md p-0.5 text-muted transition hover:text-foreground"
                aria-label="Refresh messages"
              >
                <RefreshIcon className="h-5 w-5 shrink-0" aria-hidden />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => onOpenCreateChat()}
            aria-label="New message"
          >
            <NewChatIcon className="h-6 w-6 text-accent" />
          </button>
        </header>
      </div>

      <AnimatedModal
        isPresented={isCreateChatPresented}
        isClosing={isCreateChatClosing}
        onClose={onCloseCreateChat}
        ariaLabel="New message"
        title="New message"
        closeDisabled={isCreatingThread}
        rootClassName="z-[2200] items-start px-3 pt-10"
        panelClassName="flex h-[min(92vh,40rem)] max-w-lg flex-col overflow-hidden bg-bg shadow-xl"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pt-3 pb-4">
          <TextField
            type="text"
            value={createChatTitle}
            onChange={(event) => setCreateChatTitle(event.target.value)}
            placeholder="Title..."
            disabled={isCreatingThread}
            aria-label="Chat title"
          />

          {createChatSelectedMembers.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {createChatSelectedMembers.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1 pr-1.5"
                >
                  <UserProfileImage
                    userId={member.id}
                    sizePx={24}
                    alt={`${member.username} profile`}
                    username={member.username}
                  />
                  <span className="max-w-[8rem] truncate text-xs font-medium text-foreground">
                    {member.username}
                  </span>
                  <IconButton
                    type="button"
                    variant="ghost"
                    className="h-6 w-6 shrink-0"
                    disabled={isCreatingThread}
                    aria-label={`Remove ${member.username}`}
                    onClick={() => onRemoveCreateChatMember(member.id)}
                  >
                    <CloseIcon className="h-3.5 w-3.5" />
                  </IconButton>
                </div>
              ))}
            </div>
          ) : null}

          <div className="min-h-0 flex-1">
            <UserSearch
              variant="panel"
              value={createChatSearchQuery}
              onValueChange={setCreateChatSearchQuery}
              onSelect={onSelectCreateChatMember}
              searchUsers={searchCreateChatMembers}
              placeholder="Search to add friends..."
              autoFocus
              disabled={isCreatingThread}
              noResultsText="No matching users."
            />
          </div>

          {createChatError ? (
            <p className="text-xs text-muted">{createChatError}</p>
          ) : null}

          <Button
            type="button"
            variant="primary"
            className="w-full shrink-0"
            disabled={isCreatingThread || !createChatTitle.trim()}
            onClick={() => {
              void onCreateThread();
            }}
          >
            {isCreatingThread ? "Creating..." : "Create"}
          </Button>
        </div>
      </AnimatedModal>

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
          aria-label="Search messages"
        />
      </div>

      {isLoadingThreads ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-bg px-3 py-2 text-xs text-muted">
          <Loader scale={0.7} />
          <span>Loading threads...</span>
        </div>
      ) : null}

      <div
        ref={messagesContainerRef}
        onTouchStart={onMessagesTouchStart}
        onTouchMove={onMessagesTouchMove}
        onTouchEnd={resetPullGesture}
        onTouchCancel={resetPullGesture}
        onWheel={onMessagesWheel}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y"
      >
        {!isLoadingThreads && threads.length === 0 && !searchQuery.trim() ? (
          <div className="flex flex-col items-start gap-3 px-4 py-2">
            <p className="text-xs text-muted">No messages yet. Start a new chat.</p>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => onOpenCreateChat()}
              className="inline-flex items-center gap-1.5"
            >
              <NewChatIcon className="h-4 w-4" aria-hidden />
              New message
            </Button>
          </div>
        ) : null}

        {!isLoadingThreads &&
        filteredThreads.length === 0 &&
        searchFriendSuggestions.length === 0 &&
        !isLoadingSearchFriends &&
        searchQuery.trim() ? (
          <p className="text-xs text-muted px-4">No messages match your search.</p>
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
                  onMouseDown={(event) => startPinLongPress(thread.id, event.currentTarget)}
                  onMouseUp={cancelPinLongPress}
                  onMouseLeave={cancelPinLongPress}
                  onTouchStart={(event) => startPinLongPress(thread.id, event.currentTarget)}
                  onTouchEnd={cancelPinLongPress}
                  onTouchMove={cancelPinLongPress}
                  onTouchCancel={cancelPinLongPress}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    openOptionsMenu(thread.id, event.currentTarget);
                  }}
                  className="flex select-none flex-col items-center gap-1.5 border-0 bg-transparent p-1 text-center [-webkit-touch-callout:none]"
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
          <MessageThreadRow
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
            onLongPressStart={(target) => startPinLongPress(thread.id, target)}
            onLongPressCancel={cancelPinLongPress}
            onOpenPinActions={(target) => openOptionsMenu(thread.id, target)}
          />
        ))}

        {searchQuery.trim() &&
        filteredThreads.length === 0 &&
        (isLoadingSearchFriends || searchFriendSuggestions.length > 0) ? (
          <div className="mt-2 border-t border-border/40 pt-2">
            <p className="px-4 pb-2 text-xs font-semibold text-muted">Friends</p>
            {isLoadingSearchFriends && searchFriendSuggestions.length === 0 ? (
              <p className="px-4 py-2 text-xs text-muted">Searching friends...</p>
            ) : null}
            {searchFriendSuggestions.map((friend) => {
              const isOpening = openingDirectChatUserId === friend.id;
              return (
                <div
                  key={friend.id}
                  className="flex w-full items-center gap-3 border-b border-border/30 px-4 py-3"
                >
                  <button
                    type="button"
                    disabled={openingDirectChatUserId !== null}
                    onClick={() => {
                      void onOpenDirectChatWithFriend(friend);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left transition hover:opacity-90 disabled:opacity-60"
                  >
                    <UserProfileImage
                      userId={friend.id}
                      sizePx={48}
                      alt={`${friend.username} profile`}
                      username={friend.username}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-semibold text-foreground">
                        {friend.username}
                      </p>
                      {friend.email ? (
                        <p className="truncate text-sm text-muted">{friend.email}</p>
                      ) : null}
                    </div>
                  </button>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    className="shrink-0"
                    disabled={openingDirectChatUserId !== null}
                    onClick={() => {
                      void onOpenDirectChatWithFriend(friend);
                    }}
                  >
                    {isOpening ? "Opening..." : "Message"}
                  </Button>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {statusMessage ? <p className="text-xs text-muted">{statusMessage}</p> : null}

      <MessagesThreadOptionsMenu
        thread={optionsMenuThread}
        anchorEl={optionsMenu?.anchorEl ?? null}
        isUpdatingPin={isPinningThread}
        onClose={closeOptionsMenu}
        onTogglePinned={(pinned) => {
          if (!optionsMenuThread) {
            return;
          }
          void setThreadPinned(optionsMenuThread, pinned);
        }}
      />
    </div>
  );
}


function MessageThreadRow({
  thread,
  currentUserId,
  unreadThreadIds,
  onOpenThread,
  onLongPressStart,
  onLongPressCancel,
  onOpenPinActions,
}: {
  thread: ThreadItem;
  currentUserId: string;
  unreadThreadIds: Set<string>;
  onOpenThread: (thread: ThreadItem) => void;
  onLongPressStart: (target: HTMLElement) => void;
  onLongPressCancel: () => void;
  onOpenPinActions: (target: HTMLElement) => void;
}) {
  const isUnread = unreadThreadIds.has(thread.id);

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
      onMouseDown={(event) => onLongPressStart(event.currentTarget)}
      onMouseUp={onLongPressCancel}
      onMouseLeave={onLongPressCancel}
      onTouchStart={(event) => onLongPressStart(event.currentTarget)}
      onTouchEnd={onLongPressCancel}
      onTouchMove={onLongPressCancel}
      onTouchCancel={onLongPressCancel}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenPinActions(event.currentTarget);
      }}
      className={`relative w-full cursor-pointer select-none px-4 py-3 text-left transition border-b border-border/30 outline-none [-webkit-touch-callout:none] focus-visible:ring-2 focus-visible:ring-muted/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg ${isUnread
        ? "bg-surface/50"
        : "bg-bg hover:bg-surface/20"
        }`}
    >
      <div className="flex min-h-[3rem] items-center gap-3">
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

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-base font-semibold leading-6 text-foreground">
              {thread.name}
            </p>
            {isUnread ? (
              <span
                aria-label="Unread messages"
                className="h-2 w-2 flex-shrink-0 rounded-full bg-accent"
              />
            ) : null}
          </div>
          {thread.last_message_preview ? (
            <p className="mt-0.5 line-clamp-2 text-sm leading-5 text-muted">
              {thread.last_message_preview}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}