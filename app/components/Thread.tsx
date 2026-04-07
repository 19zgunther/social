"use client";

import {
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  SetStateAction,
  TouchEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Camera, Image, Plus, Video } from "lucide-react";
import CameraModal from "@/app/components/Camera";
import Pool from "@/app/components/games/Pool";
import {
  createInitialPoolGame,
  getPoolGameFromMessageData,
  isPoolTurnForUser,
  latestPoolMessagesByGameId,
  withSecondPlayerClaimed,
} from "@/app/components/games/poolGameUtils";
import { DONT_SWIPE_TABS_CLASSNAME } from "@/app/components/utils/useSwipeBack";
import ImageViewerModal from "@/app/components/ImageViewerModal";
import CachedImage from "@/app/components/utils/CachedImage";
import EmojiPicker from "@/app/components/utils/EmojiPicker";
import { prepareImageForUpload } from "@/app/components/utils/client_file_storage_utils";
import VideoCall from "@/app/components/VideoCall";
import {
  ThreadMessageBubbleContent,
  threadMessageBubbleShellClassName,
  threadMessageBubbleShellStyle,
} from "@/app/components/ThreadMessageBubbleContent";
import {
  ApiError,
  ImageOverlayData,
  MessageData,
  EmojiItem,
  PoolGameMessageData,
  SyncResponse,
  ThreadItem,
  ThreadMember,
  ThreadMembersResponse,
  ThreadMessage,
  ThreadMessagesResponse,
  ThreadSendResponse,
} from "@/app/types/interfaces";
import { readCacheValue, writeCacheValue } from "@/app/lib/cacheSystem";
import { resolveEmojisByUuid } from "@/app/lib/customEmojiCache";
import {
  CustomEmoji,
  customEmojiUuidFromToken,
} from "@/app/lib/customEmojiCanvas";
import {
  deleteThreadReplyCollapsed,
  readThreadReplyCollapsedSet,
  writeThreadReplyCollapsed,
} from "@/app/lib/threadReplyCollapseCache";
import BackButton from "./utils/BackButton";

type ThreadProps = {
  currentUserId: string;
  currentUsername: string;
  onBack: () => void;
  setThreadSettingsOpen: () => void;
  selectedThread: ThreadItem;
  setSelectedThread: (value: SetStateAction<ThreadItem | null>) => void
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const BOTTOM_FOLLOW_THRESHOLD_PX = 80;
const BOTTOM_SWIPE_TRIGGER_PX = 48;
const MIN_BOTTOM_SWIPE_SPINNER_MS = 1_000;
/** Hold duration before opening message actions (reply, etc.). */
const MESSAGE_LONG_PRESS_TO_REPLY_MS = 500;
/** Quick reactions shown on the message options overlay (before EmojiPicker). */
const MESSAGE_OPTIONS_QUICK_EMOJIS = ["❤️", "👍", "😄", "😂", "❓", "‼️"] as const;
/** Portal stack: below EmojiPicker (2000) and games (2100). */
const MESSAGE_OPTIONS_OVERLAY_Z = 1950;
const EMOJI_ONLY_MESSAGE_REGEX =
  /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\uFE0F|\u200D|\s)+$/u;
const HAS_EMOJI_REGEX = /\p{Extended_Pictographic}/u;
const THREAD_MESSAGES_CACHE_KEY_PREFIX = "thread_messages_v1_";
const TIMESTAMP_REVEAL_MAX_PX = 68;
const TIMESTAMP_REVEAL_SETTLE_MS = 180;

type ThreadMessagesCachePayload = ThreadMessagesResponse & {
  cached_at: number;
};

const isNearBottom = (element: HTMLDivElement): boolean =>
  element.scrollHeight - element.scrollTop - element.clientHeight < BOTTOM_FOLLOW_THRESHOLD_PX;
const formatMessageTimestamp = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
};
const postWithAuth = async (path: string, body: unknown): Promise<Response> => {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
};

const mergeMessagesById = (
  currentMessages: ThreadMessage[],
  newMessages: ThreadMessage[],
): ThreadMessage[] => {
  const byId = new Map<string, ThreadMessage>();
  for (const message of currentMessages) {
    byId.set(message.id, message);
  }
  for (const message of newMessages) {
    const existingMessage = byId.get(message.id);
    byId.set(message.id, {
      ...existingMessage,
      ...message,
      image_url: message.image_url ?? existingMessage?.image_url ?? null,
    });
  }

  return Array.from(byId.values()).sort((a, b) => {
    const createdAtDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (createdAtDiff !== 0) {
      return createdAtDiff;
    }
    return a.id.localeCompare(b.id);
  });
};

const isEmojiOnlyMessage = (value: string): boolean => {
  const trimmed = value.trim();
  return (
    (Boolean(trimmed) && EMOJI_ONLY_MESSAGE_REGEX.test(trimmed) && HAS_EMOJI_REGEX.test(trimmed))
    || customEmojiUuidFromToken(trimmed) !== null
  );
};

const clampOverlayYRatio = (value: number): number => {
  if (Number.isNaN(value)) {
    return 0.5;
  }
  return Math.min(0.9, Math.max(0.1, value));
};

const toImageOverlayData = (data: MessageData | null | undefined): ImageOverlayData | null => {
  if (!data || typeof data !== "object" || !data.image_overlay) {
    return null;
  }

  const overlay = data.image_overlay;
  if (!overlay || typeof overlay.text !== "string" || typeof overlay.y_ratio !== "number") {
    return null;
  }

  const trimmedText = overlay.text.trim();
  if (!trimmedText) {
    return null;
  }

  return {
    text: trimmedText,
    y_ratio: clampOverlayYRatio(overlay.y_ratio),
  };
};

export default function Thread({
  currentUserId,
  currentUsername,
  onBack,
  setThreadSettingsOpen,
  selectedThread,
  setSelectedThread,
}: ThreadProps) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [messageDraft, setMessageDraft] = useState("");
  const [memberIdentifier, setMemberIdentifier] = useState("");
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
  const [isLoadingBottomSwipeRefresh, setIsLoadingBottomSwipeRefresh] = useState(false);
  const [hasMoreOlderMessages, setHasMoreOlderMessages] = useState(false);
  const [oldestLoadedMessageId, setOldestLoadedMessageId] = useState<string | null>(null);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [isUpdatingMembers, setIsUpdatingMembers] = useState(false);
  const [members, setMembers] = useState<ThreadMember[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isVideoCallOpen, setIsVideoCallOpen] = useState(false);
  const [memberFormError, setMemberFormError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [isGamesModalOpen, setIsGamesModalOpen] = useState(false);
  const [poolSession, setPoolSession] = useState<PoolGameMessageData | null>(null);
  const isFollowingBottomRef = useRef(true);
  const [showNewMessagesButton, setShowNewMessagesButton] = useState(false);
  const [replyTargetMessageId, setReplyTargetMessageId] = useState<string | null>(null);
  const [editTargetMessageId, setEditTargetMessageId] = useState<string | null>(null);
  const [activeOptionsMessageId, setActiveOptionsMessageId] = useState<string | null>(null);
  const [collapsedReplyMessageIds, setCollapsedReplyMessageIds] = useState<string[]>([]);
  const [imageViewer, setImageViewer] = useState<{
    signedUrl: string;
    imageId: string | null;
    alt: string;
  } | null>(null);
  const [customEmojiByUuid, setCustomEmojiByUuid] = useState<Record<string, EmojiItem>>({});
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const activeOptionsMessageIdRef = useRef<string | null>(null);
  const editTargetMessageIdRef = useRef<string | null>(null);
  const pendingBottomScrollRef = useRef<ScrollBehavior | null>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesRef = useRef<ThreadMessage[]>([]);
  const timestampSwipeStartXRef = useRef(0);
  const timestampSwipeStartYRef = useRef(0);
  const timestampSwipeTrackingRef = useRef(false);
  const bottomSwipeStartYRef = useRef<number | null>(null);
  const bottomSwipeTriggeredRef = useRef(false);
  const timestampRevealPercentRef = useRef(0);
  const timestampRevealRafRef = useRef<number | null>(null);
  const [timestampRevealPercent, setTimestampRevealPercent] = useState(0);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useLayoutEffect(() => {
    const element = composerTextareaRef.current;
    if (!element) {
      return;
    }
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [messageDraft]);

  const readErrorMessage = async (response: Response): Promise<string> => {
    try {
      const body = (await response.json()) as ApiError;
      return body.error?.message ?? "Request failed.";
    } catch {
      return "Request failed.";
    }
  };

  const cacheKeyForThread = (threadId: string): string =>
    `${THREAD_MESSAGES_CACHE_KEY_PREFIX}${threadId}`;

  const readThreadMessagesCache = useCallback(
    async (threadId: string): Promise<ThreadMessagesCachePayload | null> => {
      try {
        const cached = await readCacheValue<ThreadMessagesCachePayload>(cacheKeyForThread(threadId));
        if (!cached || !Array.isArray(cached.messages)) {
          return null;
        }
        return cached;
      } catch {
        return null;
      }
    },
    [],
  );

  const writeThreadMessagesCache = useCallback(
    async (threadId: string, payload: ThreadMessagesResponse): Promise<void> => {
      try {
        await writeCacheValue(cacheKeyForThread(threadId), {
          ...payload,
          cached_at: Date.now(),
        } satisfies ThreadMessagesCachePayload);
      } catch {
        // Best effort only.
      }
    },
    [],
  );

  useEffect(() => {
    if (!pendingBottomScrollRef.current) {
      return;
    }

    const behavior = pendingBottomScrollRef.current;
    pendingBottomScrollRef.current = null;

    requestAnimationFrame(() => {
      const container = chatContainerRef.current;
      if (!container) {
        return;
      }
      container.scrollTo({
        top: container.scrollHeight,
        behavior,
      });
      isFollowingBottomRef.current = true;
    });
  }, [messages.length]);

  useEffect(() => {
    return () => {
      if (pressTimerRef.current) {
        clearTimeout(pressTimerRef.current);
      }
      if (timestampRevealRafRef.current !== null) {
        cancelAnimationFrame(timestampRevealRafRef.current);
      }
    };
  }, []);

  const cancelTimestampRevealAnimation = () => {
    if (timestampRevealRafRef.current !== null) {
      cancelAnimationFrame(timestampRevealRafRef.current);
      timestampRevealRafRef.current = null;
    }
  };

  const setTimestampReveal = (value: number) => {
    const clamped = Math.max(0, Math.min(1, value));
    timestampRevealPercentRef.current = clamped;
    setTimestampRevealPercent(clamped);
  };

  const settleTimestampReveal = () => {
    const from = timestampRevealPercentRef.current;
    cancelTimestampRevealAnimation();
    if (from <= 0) {
      setTimestampReveal(0);
      return;
    }

    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / TIMESTAMP_REVEAL_SETTLE_MS);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = from * (1 - eased);
      setTimestampReveal(next);
      if (progress < 1) {
        timestampRevealRafRef.current = requestAnimationFrame(step);
      } else {
        timestampRevealRafRef.current = null;
      }
    };
    timestampRevealRafRef.current = requestAnimationFrame(step);
  };

  useEffect(() => {
    let isCancelled = false;

    setMessages([]);
    setMembers([]);
    setMessageDraft("");
    setMemberIdentifier("");
    setIsSettingsOpen(false);
    setStatusMessage("");
    setMemberFormError("");
    setShowNewMessagesButton(false);
    setHasMoreOlderMessages(false);
    setOldestLoadedMessageId(null);
    setIsLoadingOlderMessages(false);
    setIsCameraModalOpen(false);
    setIsGamesModalOpen(false);
    setPoolSession(null);
    setImageViewer(null);
    setCustomEmojiByUuid({});
    setCollapsedReplyMessageIds([]);

    const loadThread = async () => {
      setIsLoadingMessages(true);
      setIsLoadingMembers(true);
      const thread = selectedThread;

      try {
        const cached = await readThreadMessagesCache(thread.id);
        if (!isCancelled && cached) {
          setSelectedThread((previousThread: ThreadItem | null) => ({
            ...previousThread as ThreadItem,
            name: cached.thread.name,
            owner_user_id: cached.thread.owner_user_id,
          }));
          setMessages(cached.messages);
          setHasMoreOlderMessages(cached.has_more_older);
          setOldestLoadedMessageId(cached.next_cursor_message_id);
          pendingBottomScrollRef.current = "instant";
          setIsLoadingMessages(false);
        }

        const response = await postWithAuth("/api/thread-messages", { thread_id: thread.id });
        if (!response.ok) {
          if (!isCancelled) {
            setStatusMessage(await readErrorMessage(response));
            setMessages([]);
          }
        } else {
          const payload = (await response.json()) as ThreadMessagesResponse;

          if (!isCancelled) {
            setSelectedThread((previousThread: ThreadItem | null) => ({
              ...previousThread as ThreadItem,
              name: payload.thread.name,
              owner_user_id: payload.thread.owner_user_id,
            }));
            setMessages(payload.messages);
            setHasMoreOlderMessages(payload.has_more_older);
            setOldestLoadedMessageId(payload.next_cursor_message_id);
            pendingBottomScrollRef.current = "instant";
          }

          void writeThreadMessagesCache(thread.id, payload);
        }
      } catch (error) {
        if (!isCancelled) {
          setStatusMessage(error instanceof Error ? error.message : "Failed to load thread.");
          setMessages([]);
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingMessages(false);
        }
      }

      try {
        const membersResponse = await postWithAuth("/api/thread-members", { thread_id: thread.id });
        if (!membersResponse.ok) {
          if (!isCancelled) {
            setStatusMessage(await readErrorMessage(membersResponse));
            setMembers([]);
          }
          return;
        }

        const membersPayload = (await membersResponse.json()) as ThreadMembersResponse;
        if (!isCancelled) {
          setMembers(membersPayload.members);
        }
      } catch (error) {
        if (!isCancelled) {
          setStatusMessage(error instanceof Error ? error.message : "Failed to load members.");
          setMembers([]);
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingMembers(false);
        }
      }
    };

    void loadThread();

    return () => {
      isCancelled = true;
    };
  }, [readThreadMessagesCache, writeThreadMessagesCache]);

  const customEmojiUuidsInMessages = useMemo(() => {
    const uuids = new Set<string>();
    messages.forEach((message) => {
      const uuid = customEmojiUuidFromToken(message.text);
      if (uuid) {
        uuids.add(uuid);
      }
    });
    return Array.from(uuids);
  }, [messages]);

  useEffect(() => {
    if (customEmojiUuidsInMessages.length === 0) {
      setCustomEmojiByUuid({});
      return;
    }
    let cancelled = false;
    const resolveCustomEmojis = async () => {
      try {
        const merged = await resolveEmojisByUuid(customEmojiUuidsInMessages);
        if (!cancelled) {
          setCustomEmojiByUuid(merged);
        }
      } catch {
        // Best effort; unresolved custom emoji falls back to token text.
      }
    };
    void resolveCustomEmojis();
    return () => {
      cancelled = true;
    };
  }, [customEmojiUuidsInMessages]);

  const loadOlderMessages = async () => {
    if (
      !hasMoreOlderMessages ||
      !oldestLoadedMessageId ||
      isLoadingOlderMessages ||
      isLoadingMessages
    ) {
      return;
    }

    const container = chatContainerRef.current;
    const previousScrollHeight = container?.scrollHeight ?? 0;
    const previousScrollTop = container?.scrollTop ?? 0;
    setIsLoadingOlderMessages(true);

    try {
      const response = await postWithAuth("/api/thread-messages", {
        thread_id: selectedThread.id,
        cursor_message_id: oldestLoadedMessageId,
      });

      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }

      const payload = (await response.json()) as ThreadMessagesResponse;

      if (payload.messages.length > 0) {
        setMessages((previousMessages) => [...payload.messages, ...previousMessages]);
        setOldestLoadedMessageId(payload.next_cursor_message_id);
      }
      setHasMoreOlderMessages(payload.has_more_older);

      requestAnimationFrame(() => {
        const activeContainer = chatContainerRef.current;
        if (!activeContainer) {
          return;
        }
        const newScrollHeight = activeContainer.scrollHeight;
        activeContainer.scrollTop = newScrollHeight - previousScrollHeight + previousScrollTop;
      });
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to load older messages.");
    } finally {
      setIsLoadingOlderMessages(false);
    }
  };

  const onChatScroll = () => {
    const container = chatContainerRef.current;
    if (!container) {
      return;
    }

    isFollowingBottomRef.current = isNearBottom(container);

    if (isNearBottom(container)) {
      setShowNewMessagesButton(false);
    }

    if (container.scrollTop > 40) {
      return;
    }
    void loadOlderMessages();
  };

  const onTimestampSwipeStart = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!touch) {
      return;
    }
    timestampSwipeStartXRef.current = touch.clientX;
    timestampSwipeStartYRef.current = touch.clientY;
    timestampSwipeTrackingRef.current = true;
    cancelTimestampRevealAnimation();
  };

  const triggerBottomSwipeRefresh = async (): Promise<void> => {
    if (isLoadingBottomSwipeRefresh || isLoadingMessages || isLoadingOlderMessages) {
      return;
    }

    const startedAt = Date.now();
    setIsLoadingBottomSwipeRefresh(true);
    try {
      await applyLatestMessagesFromServer("always");
    } finally {
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_BOTTOM_SWIPE_SPINNER_MS) {
        await sleep(MIN_BOTTOM_SWIPE_SPINNER_MS - elapsed);
      }
      setIsLoadingBottomSwipeRefresh(false);
    }
  };

  const onBottomSwipeStart = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!touch) {
      bottomSwipeStartYRef.current = null;
      bottomSwipeTriggeredRef.current = false;
      return;
    }
    const container = chatContainerRef.current;
    if (!container || !isNearBottom(container)) {
      bottomSwipeStartYRef.current = null;
      bottomSwipeTriggeredRef.current = false;
      return;
    }
    bottomSwipeStartYRef.current = touch.clientY;
    bottomSwipeTriggeredRef.current = false;
  };

  const onBottomSwipeMove = (event: TouchEvent<HTMLDivElement>) => {
    const startY = bottomSwipeStartYRef.current;
    if (startY === null || bottomSwipeTriggeredRef.current) {
      return;
    }
    const touch = event.touches[0];
    if (!touch) {
      return;
    }
    const deltaY = touch.clientY - startY;
    if (deltaY > -BOTTOM_SWIPE_TRIGGER_PX) {
      return;
    }
    bottomSwipeTriggeredRef.current = true;
    void triggerBottomSwipeRefresh();
  };

  const onBottomSwipeEnd = () => {
    bottomSwipeStartYRef.current = null;
    bottomSwipeTriggeredRef.current = false;
  };

  const onTimestampSwipeMove = (event: TouchEvent<HTMLDivElement>) => {
    if (!timestampSwipeTrackingRef.current) {
      return;
    }
    const touch = event.touches[0];
    if (!touch) {
      return;
    }

    const deltaX = touch.clientX - timestampSwipeStartXRef.current;
    const deltaY = touch.clientY - timestampSwipeStartYRef.current;

    // Keep regular vertical scrolling responsive and only react to mostly-horizontal drags.
    if (Math.abs(deltaY) > Math.abs(deltaX) * 1.2) {
      return;
    }

    const nextPercent = Math.max(0, Math.min(1, -deltaX / TIMESTAMP_REVEAL_MAX_PX));
    setTimestampReveal(nextPercent);
  };

  const onTimestampSwipeEnd = () => {
    if (!timestampSwipeTrackingRef.current) {
      return;
    }
    timestampSwipeTrackingRef.current = false;
    settleTimestampReveal();
  };

  const applyLatestMessagesFromServer = useCallback(
    async (scrollHintMode: "always" | "onlyWhenNew") => {
      const threadId = selectedThread.id;
      const container = chatContainerRef.current;
      const wasNearBottom = container ? isNearBottom(container) : false;

      const latestResponse = await postWithAuth("/api/thread-messages", {
        thread_id: threadId,
      });

      if (!latestResponse.ok) {
        return;
      }

      const latestPayload = (await latestResponse.json()) as ThreadMessagesResponse;

      const previousSnapshot = messagesRef.current;
      const prevIds = new Set(previousSnapshot.map((message) => message.id));
      const hasNewMessage = latestPayload.messages.some((message) => !prevIds.has(message.id));

      setMessages((previousMessages) => mergeMessagesById(previousMessages, latestPayload.messages));
      setHasMoreOlderMessages((previousValue) => previousValue || latestPayload.has_more_older);
      setOldestLoadedMessageId(
        (previousCursorId) => previousCursorId ?? latestPayload.next_cursor_message_id,
      );

      void writeThreadMessagesCache(threadId, latestPayload);

      const shouldUpdateScrollHints =
        scrollHintMode === "always" ||
        (scrollHintMode === "onlyWhenNew" && hasNewMessage);

      if (!shouldUpdateScrollHints) {
        return;
      }

      if (wasNearBottom) {
        pendingBottomScrollRef.current = "smooth";
        setShowNewMessagesButton(false);
        isFollowingBottomRef.current = true;
      } else {
        setShowNewMessagesButton(true);
        isFollowingBottomRef.current = false;
      }
    },
    [selectedThread.id, writeThreadMessagesCache],
  );

  useEffect(() => {
    let isCancelled = false;

    const pollSyncEvents = async () => {
      while (!isCancelled) {
        try {
          const syncResponse = await postWithAuth("/api/sync", {
            timeout_ms: 25_000,
            max_events: 20,
          });

          if (!syncResponse.ok) {
            if (syncResponse.status === 401) {
              return;
            }
            await sleep(1_000);
            continue;
          }

          const payload = (await syncResponse.json()) as SyncResponse;
          if (payload.events.length === 0) {
            continue;
          }

          const needsThreadRefresh = payload.events.some(
            (event) =>
              (event.type === "thread_message_posted" ||
                event.type === "thread_message_updated") &&
              event.thread_id === selectedThread.id,
          );

          if (!needsThreadRefresh) {
            continue;
          }

          await applyLatestMessagesFromServer("always");
        } catch {
          await sleep(1_000);
        }
      }
    };

    void pollSyncEvents();

    return () => {
      isCancelled = true;
    };
  }, [applyLatestMessagesFromServer, selectedThread.id, currentUserId]);

  useEffect(() => {
    if (isLoadingMessages) {
      return;
    }

    let cancelled = false;
    const tick = async () => {
      if (cancelled) {
        return;
      }
      await applyLatestMessagesFromServer("onlyWhenNew");
    };

    const intervalId = window.setInterval(() => {
      void tick();
    }, 20_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [applyLatestMessagesFromServer, isLoadingMessages, selectedThread.id]);

  const sendThreadMessage = async ({
    text,
    imageBase64Data,
    imageMimeType,
    imagePreviewDataUrl,
    imageOverlay,
    replyToMessageId,
    clearDraftOnSuccess,
  }: {
    text: string;
    imageBase64Data?: string;
    imageMimeType?: string;
    imagePreviewDataUrl?: string;
    imageOverlay?: ImageOverlayData;
    replyToMessageId?: string;
    clearDraftOnSuccess?: boolean;
  }): Promise<void> => {
    setIsSendingMessage(true);
    setStatusMessage("");
    const effectiveReplyTargetMessageId = replyToMessageId ?? replyTargetMessageId;

    const trimmedText = text.trim();
    const messageData = imageOverlay
      ? {
        image_overlay: {
          text: imageOverlay.text.trim(),
          y_ratio: clampOverlayYRatio(imageOverlay.y_ratio),
        },
      }
      : undefined;

    try {
      const response = await postWithAuth("/api/thread-send", {
        thread_id: selectedThread.id,
        text: trimmedText,
        ...(effectiveReplyTargetMessageId
          ? { reply_to_message_id: effectiveReplyTargetMessageId }
          : {}),
        ...(imageBase64Data && imageMimeType
          ? {
            image_base64_data: imageBase64Data,
            image_mime_type: imageMimeType,
          }
          : {}),
        ...(messageData ? { message_data: messageData } : {}),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const payload = (await response.json()) as ThreadSendResponse;
      const newMessage = {
        ...payload.message,
        image_url: payload.message.image_url ?? imagePreviewDataUrl ?? null,
        data: payload.message.data ?? messageData ?? null,
        direct_reply_count: 0,
      };

      setMessages((previous) => [...previous, newMessage]);
      if (!oldestLoadedMessageId) {
        setOldestLoadedMessageId(payload.message.id);
      }

      if (clearDraftOnSuccess) {
        setMessageDraft("");
      }

      setShowNewMessagesButton(false);
      isFollowingBottomRef.current = true;
      if (effectiveReplyTargetMessageId) {
        const toUncollapse: string[] = [];
        let cursor: ThreadMessage | undefined = messageById.get(effectiveReplyTargetMessageId);
        let safety = 0;
        while (cursor && safety < 100) {
          toUncollapse.push(cursor.id);
          if (!cursor.parent_id || cursor.parent_id === selectedThread.id) {
            break;
          }
          cursor = messageById.get(cursor.parent_id);
          safety += 1;
        }
        for (const id of toUncollapse) {
          void deleteThreadReplyCollapsed(id);
        }
        setCollapsedReplyMessageIds((previous) => {
          const drop = new Set(toUncollapse);
          return previous.filter((id) => !drop.has(id));
        });
      }
      setReplyTargetMessageId(null);
      setActiveOptionsMessageId(null);
      pendingBottomScrollRef.current = "smooth";
    } finally {
      setIsSendingMessage(false);
    }
  };

  const sendPoolGameMessage = async (poolGame: PoolGameMessageData): Promise<PoolGameMessageData> => {
    setIsSendingMessage(true);
    setStatusMessage("");
    const claimSecondSeat = (pg: PoolGameMessageData): PoolGameMessageData => {
      if (pg.player_b_username !== null) {
        return pg;
      }
      if (pg.player_a_username === currentUsername) {
        return pg;
      }
      return { ...pg, player_b_username: currentUsername };
    };
    try {
      const response = await postWithAuth("/api/thread-send", {
        thread_id: selectedThread.id,
        text: "",
        message_data: { pool_game: claimSecondSeat(poolGame) },
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const payload = (await response.json()) as ThreadSendResponse;
      const sanitized = getPoolGameFromMessageData(payload.message.data);
      if (!sanitized) {
        throw new Error("Server did not accept pool game data.");
      }

      const newMessage: ThreadMessage = {
        ...payload.message,
        direct_reply_count: 0,
      };

      setMessages((previous) => [...previous, newMessage]);
      if (!oldestLoadedMessageId) {
        setOldestLoadedMessageId(payload.message.id);
      }

      setShowNewMessagesButton(false);
      isFollowingBottomRef.current = true;
      pendingBottomScrollRef.current = "smooth";
      return sanitized;
    } finally {
      setIsSendingMessage(false);
    }
  };

  const startNewPoolGame = async () => {
    const hasSomeoneElse = members.some((member) => member.user_id !== currentUserId);
    if (!hasSomeoneElse) {
      setStatusMessage("Add another member to this thread to play Pool.");
      return;
    }

    try {
      const game = createInitialPoolGame({
        gameId: crypto.randomUUID(),
        playerAUsername: currentUsername,
        startingUsername: currentUsername,
      });
      const saved = await sendPoolGameMessage(game);
      setIsGamesModalOpen(false);
      setPoolSession(saved);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not start Pool.");
    }
  };

  const onSendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!messageDraft.trim()) {
      return;
    }

    if (editTargetMessageId) {
      await onEditMessage();
      return;
    }

    try {
      await sendThreadMessage({
        text: messageDraft,
        clearDraftOnSuccess: true,
      });
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to send message.");
    }
  };

  const openCameraModal = () => {
    if (editTargetMessageId) {
      return;
    }
    setIsCameraModalOpen(true);
  };

  const onSendPhotoFromCamera = async (payload: {
    file: File;
    overlayText: string;
    overlayYRatio: number;
  }) => {
    try {
      const preparedImage = await prepareImageForUpload(payload.file);
      await sendThreadMessage({
        text: "",
        imageBase64Data: preparedImage.base64Data,
        imageMimeType: preparedImage.mimeType,
        imagePreviewDataUrl: preparedImage.previewDataUrl,
        imageOverlay: payload.overlayText.trim()
          ? {
            text: payload.overlayText.trim(),
            y_ratio: payload.overlayYRatio,
          }
          : undefined,
        clearDraftOnSuccess: false,
      });
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to send photo.");
      throw error;
    }
  };

  const messageById = new Map(messages.map((message) => [message.id, message]));

  const activeOptionsMessage = useMemo(
    () =>
      activeOptionsMessageId ? messages.find((m) => m.id === activeOptionsMessageId) ?? null : null,
    [activeOptionsMessageId, messages],
  );

  const messageIdsFingerprint = useMemo(
    () =>
      [...new Set(messages.map((message) => message.id))]
        .sort()
        .join(","),
    [messages],
  );

  const collapsedReplyIdSet = useMemo(
    () => new Set(collapsedReplyMessageIds),
    [collapsedReplyMessageIds],
  );

  useEffect(() => {
    const unique = [...new Set(messages.map((message) => message.id))];
    if (unique.length === 0) {
      setCollapsedReplyMessageIds([]);
      return;
    }

    let cancelled = false;
    void readThreadReplyCollapsedSet(unique).then((fromDb) => {
      if (cancelled) {
        return;
      }
      setCollapsedReplyMessageIds((previous) => {
        const next = new Set<string>(fromDb);
        for (const id of previous) {
          if (unique.includes(id)) {
            next.add(id);
          }
        }
        return [...next];
      });
    });

    return () => {
      cancelled = true;
    };
  }, [selectedThread.id, messageIdsFingerprint]);

  activeOptionsMessageIdRef.current = activeOptionsMessageId;
  editTargetMessageIdRef.current = editTargetMessageId;

  const closeMessageOptionsOverlay = useCallback(() => {
    const activeId = activeOptionsMessageIdRef.current;
    const editId = editTargetMessageIdRef.current;
    setActiveOptionsMessageId(null);
    if (activeId !== null) {
      setReplyTargetMessageId((reply) => (reply === activeId ? null : reply));
      if (editId === activeId) {
        setEditTargetMessageId(null);
        setMessageDraft("");
      }
    }
  }, []);

  useEffect(() => {
    if (!activeOptionsMessageId) {
      return;
    }
    const exists = messages.some((m) => m.id === activeOptionsMessageId);
    if (!exists) {
      const missingId = activeOptionsMessageId;
      setActiveOptionsMessageId(null);
      setReplyTargetMessageId((reply) => (reply === missingId ? null : reply));
      setEditTargetMessageId((edit) => (edit === missingId ? null : edit));
      if (editTargetMessageId === missingId) {
        setMessageDraft("");
      }
    }
  }, [activeOptionsMessageId, messages, editTargetMessageId]);

  useEffect(() => {
    if (!activeOptionsMessageId) {
      return;
    }
    const onKeyDown = (event: WindowEventMap["keydown"]) => {
      if (event.key === "Escape") {
        closeMessageOptionsOverlay();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [activeOptionsMessageId, closeMessageOptionsOverlay]);

  useEffect(() => {
    if (!activeOptionsMessageId) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [activeOptionsMessageId]);

  const isHiddenUnderCollapsedParent = (message: ThreadMessage): boolean => {
    let cursorId: string | null = message.parent_id;
    let safety = 0;
    while (cursorId && cursorId !== selectedThread.id && safety < 100) {
      if (collapsedReplyIdSet.has(cursorId)) {
        return true;
      }
      cursorId = messageById.get(cursorId)?.parent_id ?? null;
      safety += 1;
    }
    return false;
  };

  const toggleRepliesCollapsedForMessageId = (messageId: string) => {
    setCollapsedReplyMessageIds((previous) => {
      if (previous.includes(messageId)) {
        void deleteThreadReplyCollapsed(messageId);
        return previous.filter((id) => id !== messageId);
      }
      void writeThreadReplyCollapsed(messageId);
      return [...previous, messageId];
    });
  };

  const latestPoolByGameId = latestPoolMessagesByGameId(messages);
  const latestPoolMessageIds = new Set(
    Array.from(latestPoolByGameId.values()).map((entry) => entry.message.id),
  );

  const visibleMessages = messages.filter((message) => {
    const hasText = message.text.trim().length > 0;
    const hasImage = Boolean(message.image_url);
    const hasOverlay = Boolean(toImageOverlayData(message.data));
    const poolGame = getPoolGameFromMessageData(message.data);
    if (poolGame && !latestPoolMessageIds.has(message.id)) {
      return false;
    }
    const showLatestPool = Boolean(poolGame && latestPoolMessageIds.has(message.id));
    // Hide pure signaling / data-only messages (e.g., video call signals) from the chat UI.
    return hasText || hasImage || hasOverlay || showLatestPool;
  });

  const rootMessages = visibleMessages.filter((message) => message.parent_id === selectedThread.id);
  const childMessagesByParentId = new Map<string, ThreadMessage[]>();
  for (const message of visibleMessages) {
    if (!message.parent_id || message.parent_id === selectedThread.id) {
      continue;
    }

    const existing = childMessagesByParentId.get(message.parent_id) ?? [];
    existing.push(message);
    childMessagesByParentId.set(message.parent_id, existing);
  }

  const cancelPressTimer = () => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  };

  const startLongPress = (messageId: string) => {
    cancelPressTimer();
    pressTimerRef.current = setTimeout(() => {
      setActiveOptionsMessageId(messageId);
      setReplyTargetMessageId(messageId);
      setEditTargetMessageId(null);
    }, MESSAGE_LONG_PRESS_TO_REPLY_MS);
  };

  const onEditMessage = async () => {
    const editingId = editTargetMessageId;
    if (!editingId || !messageDraft.trim()) {
      return;
    }

    setIsSendingMessage(true);
    setStatusMessage("");

    try {
      const response = await postWithAuth("/api/thread-edit", {
        thread_id: selectedThread.id,
        message_id: editingId,
        text: messageDraft,
      });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }

      const payload = (await response.json()) as ThreadSendResponse;
      setMessages((previousMessages) =>
        previousMessages.map((message) =>
          message.id === payload.message.id
            ? {
              ...message,
              text: payload.message.text,
            }
            : message,
        ),
      );
      setMessageDraft("");
      setEditTargetMessageId(null);
      setActiveOptionsMessageId((active) => (active === editingId ? null : active));
      setReplyTargetMessageId((reply) => (reply === editingId ? null : reply));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to edit message.");
    } finally {
      setIsSendingMessage(false);
    }
  };

  const onSendEmojiReply = async (replyToMessageId: string, emoji: string) => {
    if (!emoji.trim()) {
      return;
    }

    setActiveOptionsMessageId(null);
    setEditTargetMessageId(null);
    setReplyTargetMessageId(null);

    try {
      await sendThreadMessage({
        text: emoji,
        replyToMessageId,
        clearDraftOnSuccess: false,
      });
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to send emoji reply.");
    }
  };

  const onMessageOptionsOverlayRootClick = (event: MouseEvent<HTMLDivElement>) => {
    const { target } = event;
    if (!(target instanceof Element)) {
      return;
    }
    if (
      target.closest(
        'button, a, input, textarea, select, label, [role="button"], [contenteditable="true"], canvas, form',
      )
    ) {
      return;
    }
    closeMessageOptionsOverlay();
  };

  const copyActiveOptionsMessage = async (message: ThreadMessage) => {
    const text = message.text.trim();
    const fallback = message.image_url?.trim() ?? "";
    const toCopy = text || fallback;
    if (!toCopy) {
      setStatusMessage("Nothing to copy.");
      closeMessageOptionsOverlay();
      return;
    }
    try {
      await navigator.clipboard.writeText(toCopy);
      setStatusMessage("Copied.");
      closeMessageOptionsOverlay();
    } catch {
      setStatusMessage("Could not copy.");
    }
  };

  const renderOptionsTargetBubble = (message: ThreadMessage, depth: number) => {
    const isOwnMessage = message.created_by === currentUserId;
    const hasText = message.text.trim().length > 0;
    const hasImage = Boolean(message.image_url);
    const isImageOnly = hasImage && !hasText;
    const messageImageOverlay = toImageOverlayData(message.data);

    return (
      <div
        className={threadMessageBubbleShellClassName(isOwnMessage, isImageOnly, depth, "static")}
        style={threadMessageBubbleShellStyle(depth)}
      >
        <ThreadMessageBubbleContent
          message={message}
          currentUserId={currentUserId}
          customEmojiByUuid={customEmojiByUuid}
          messageImageOverlay={messageImageOverlay}
          imageInteraction="options"
          onOpenImageViewer={() => {
            setImageViewer({
              signedUrl: message.image_url!,
              imageId: message.image_id,
              alt: "Thread message attachment",
            });
          }}
        />
      </div>
    );
  };

  const renderMessage = (message: ThreadMessage, depth: number) => {
    const isOwnMessage = message.created_by === currentUserId;
    const hasText = message.text.trim().length > 0;
    const hasImage = Boolean(message.image_url);
    const isImageOnly = hasImage && !hasText;
    const messageImageOverlay = toImageOverlayData(message.data);
    const poolGame = getPoolGameFromMessageData(message.data);
    const showPoolCard = poolGame && latestPoolMessageIds.has(message.id);

    if (depth > 0 && isHiddenUnderCollapsedParent(message)) {
      return null;
    }

    if (showPoolCard && poolGame) {
      const isLockedPlayer =
        poolGame.player_a_username === currentUsername ||
        poolGame.player_b_username === currentUsername;
      const canJoinAsOpponent =
        poolGame.player_b_username === null &&
        poolGame.current_turn_username === null &&
        currentUsername !== poolGame.player_a_username;
      const canInteract = isLockedPlayer || canJoinAsOpponent;
      const myTurn = canInteract && isPoolTurnForUser(poolGame, currentUsername);

      const opponentUsername =
        poolGame.player_a_username === currentUsername
          ? poolGame.player_b_username
          : poolGame.player_b_username === currentUsername
            ? poolGame.player_a_username
            : null;

      let statusHint: string;
      if (myTurn) {
        statusHint = "Your turn — take a shot.";
      } else if (!canInteract) {
        statusHint = "Spectating — only the host and first responder play.";
      } else if (poolGame.current_turn_username !== null) {
        statusHint = `Waiting for ${poolGame.current_turn_username}.`;
      } else if (poolGame.player_b_username === null) {
        statusHint =
          currentUsername === poolGame.player_a_username
            ? "Waiting for someone to take the first shot as Player 2."
            : "Tap Play to join as Player 2 (first tap wins if several people try).";
      } else {
        statusHint = `Waiting for ${poolGame.player_b_username}.`;
      }

      if (depth > 0) {
        return null;
      }

      return (
        <div key={message.id} className="relative max-w-[85%]">
          <div
            className={`rounded-2xl border border-accent-1 bg-secondary-background px-3 py-3 shadow-sm ${isOwnMessage ? "ml-auto" : ""}`}
          >
            <p className="text-xs opacity-60">{isOwnMessage ? "You" : message.username}</p>
            <p className="text-sm font-semibold text-foreground">🎱 Pool</p>
            <p className="mt-1 text-xs text-accent-2">
              {isLockedPlayer ? (
                <>
                  vs{" "}
                  <span className="text-foreground">
                    {opponentUsername ?? "…"}
                  </span>
                  {!opponentUsername ? (
                    <span className="text-accent-2"> (Player 2 not joined yet)</span>
                  ) : null}
                </>
              ) : canJoinAsOpponent ? (
                <>
                  Host <span className="text-foreground">{poolGame.player_a_username}</span> — you can join as Player 2
                </>
              ) : (
                <>
                  {poolGame.player_a_username}
                  {poolGame.player_b_username ? (
                    <> vs {poolGame.player_b_username}</>
                  ) : (
                    <> — waiting for Player 2</>
                  )}
                </>
              )}
            </p>
            <p className="mt-2 text-xs text-accent-2">{statusHint}</p>
            <button
              type="button"
              disabled={!myTurn || Boolean(editTargetMessageId)}
              onClick={() => {
                if (!myTurn) {
                  return;
                }
                setPoolSession(withSecondPlayerClaimed(poolGame, currentUsername));
              }}
              className="mt-3 w-full rounded-full border border-accent-1 bg-accent-3/20 py-2 text-xs font-semibold text-foreground transition hover:bg-accent-3/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {myTurn ? "Play" : "Not your turn"}
            </button>
          </div>
          <p
            className="pointer-events-none absolute right-[-68px] top-1/2 w-16 -translate-y-1/2 text-right text-[11px] text-accent-2/90 transition-opacity duration-75"
            style={{ opacity: timestampRevealPercent }}
          >
            {formatMessageTimestamp(message.created_at)}
          </p>
        </div>
      );
    }

    const children = childMessagesByParentId.get(message.id) ?? [];
    const emojiOnlyChildren = children.filter((childMessage) => isEmojiOnlyMessage(childMessage.text));
    const threadedChildren = children.filter((childMessage) => !isEmojiOnlyMessage(childMessage.text));
    const isRepliesSubtreeExpanded = !collapsedReplyIdSet.has(message.id);
    const isReplyTargetMessage = replyTargetMessageId === message.id;

    return (
      <div key={message.id}>
        <div
          onMouseDown={() => startLongPress(message.id)}
          onMouseUp={cancelPressTimer}
          onMouseLeave={cancelPressTimer}
          onMouseMove={(event) => {
            if (event.buttons === 1) {
              cancelPressTimer();
            }
          }}
          onTouchStart={() => startLongPress(message.id)}
          onTouchEnd={cancelPressTimer}
          onTouchMove={cancelPressTimer}
          onTouchCancel={cancelPressTimer}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setActiveOptionsMessageId(message.id);
            setReplyTargetMessageId(message.id);
            setEditTargetMessageId(null);
          }}
          className={threadMessageBubbleShellClassName(isOwnMessage, isImageOnly, depth, "chat")}
          style={threadMessageBubbleShellStyle(depth)}
        >
          <ThreadMessageBubbleContent
            message={message}
            currentUserId={currentUserId}
            customEmojiByUuid={customEmojiByUuid}
            messageImageOverlay={messageImageOverlay}
            imageInteraction="chat"
            onOpenImageViewer={() => {
              setImageViewer({
                signedUrl: message.image_url!,
                imageId: message.image_id,
                alt: "Thread message attachment",
              });
            }}
            onImageLoaded={handleMessageImageLoad}
          />
          <p
            className="pointer-events-none absolute right-[-68px] top-1/2 w-16 -translate-y-1/2 text-right text-[11px] text-accent-2/90 transition-opacity duration-75"
            style={{ opacity: timestampRevealPercent }}
          >
            {formatMessageTimestamp(message.created_at)}
          </p>
        </div>

        {emojiOnlyChildren.length > 0 && (
          <div className="ml-1 flex flex-wrap items-center gap-1 transform translate-y-[-4px]">
            {emojiOnlyChildren.map((childMessage) => {
              const childCustomEmojiUuid = customEmojiUuidFromToken(childMessage.text);
              const childCustomEmoji = childCustomEmojiUuid ? customEmojiByUuid[childCustomEmojiUuid] : undefined;
              if (childCustomEmoji) {
                return <CustomEmoji key={childMessage.id} customEmoji={childCustomEmoji} />;
              }
              return (
                <span key={childMessage.id} className="text-base leading-none">
                  {childMessage.text.trim()}
                </span>
              );
            })}
          </div>
        )}

        {threadedChildren.length > 0 ? (
          <button
            type="button"
            onClick={() => toggleRepliesCollapsedForMessageId(message.id)}
            className="mt-1 ml-1 text-xs text-accent-2 underline underline-offset-2 hover:text-foreground"
          >
            {isRepliesSubtreeExpanded ? "Hide replies" : `${threadedChildren.length} replies`}
          </button>
        ) : null}

        {threadedChildren.length > 0 && isRepliesSubtreeExpanded ? (
          <div className="mt-1 mx-2 space-y-1 border-l border-r border-accent-1/60">
            {threadedChildren.map((childMessage) => renderMessage(childMessage, depth + 1))}
          </div>
        ) : null}

        {isReplyTargetMessage ? (
          <div className="mt-1 ml-1 text-xs text-accent-2">
            Replying to this message
            <button
              type="button"
              onClick={() => setReplyTargetMessageId(null)}
              className="ml-2 p-4 underline underline-offset-2 hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        ) : null}
      </div>
    );
  };

  const isComposerExpanded =
    isComposerFocused || Boolean(editTargetMessageId) || messageDraft.trim().length > 0;
  const messagesRevealOffsetPx = Math.round(timestampRevealPercent * TIMESTAMP_REVEAL_MAX_PX);

  const handleMessageImageLoad = () => {
    const container = chatContainerRef.current;
    if (!container || !isFollowingBottomRef.current) {
      return;
    }

    requestAnimationFrame(() => {
      const activeContainer = chatContainerRef.current;
      if (!activeContainer) {
        return;
      }
      activeContainer.scrollTop = activeContainer.scrollHeight;
    });
  };

  if (poolSession) {
    return (
      <Pool
        game={poolSession}
        currentUsername={currentUsername}
        onBack={() => setPoolSession(null)}
        onTurnComplete={async (nextGame) => {
          await sendPoolGameMessage(nextGame);
        }}
      />
    );
  }

  if (isVideoCallOpen) {
    return (
      <VideoCall
        threadId={selectedThread.id}
        currentUserId={currentUserId}
        onBack={() => setIsVideoCallOpen(false)}
      />
    );
  }

  const messageComposerForm = (
    <form onSubmit={onSendMessage} className="mx-2 mb-2 mt-1 flex items-end gap-2">
      <textarea
        ref={composerTextareaRef}
        rows={1}
        className={`min-h-10 resize-none overflow-hidden rounded-2xl border border-accent-1 bg-secondary-background px-4 py-2 text-sm leading-normal text-foreground break-words outline-none focus:border-accent-2 transition-[border-color] duration-200 ${isComposerExpanded ? "flex-1" : "w-1/2"
          }`}
        placeholder={
          editTargetMessageId
            ? "Edit message..."
            : activeOptionsMessageId
              ? "Reply to message..."
              : "Type a message..."
        }
        value={messageDraft}
        onChange={(event) => setMessageDraft(event.target.value)}
        onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
          if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) {
            return;
          }
          event.preventDefault();
          const form = event.currentTarget.form;
          if (!form || isSendingMessage || !messageDraft.trim()) {
            return;
          }
          form.requestSubmit();
        }}
        onFocus={() => setIsComposerFocused(true)}
        onBlur={() => {
          if (!messageDraft.trim() && !editTargetMessageId) {
            setIsComposerFocused(false);
          }
        }}
      />

      {!isComposerExpanded ? (
        <>
          <button
            type="button"
            onClick={() => {
              openCameraModal();
            }}
            disabled={Boolean(editTargetMessageId)}
            className="flex-1 rounded-full border border-accent-1 px-3 py-3 text-xs font-semibold text-accent-2 transition hover:text-foreground disabled:opacity-50"
            aria-label="Take photo"
          >
            <Camera className="mx-auto h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setIsGamesModalOpen(true)}
            disabled={Boolean(editTargetMessageId)}
            className="flex shrink-0 items-center justify-center rounded-full border border-accent-1 px-3 py-3 text-xs font-semibold text-accent-2 transition hover:text-foreground disabled:opacity-50"
            aria-label="Games"
          >
            <Plus className="h-4 w-4" />
          </button>
        </>
      ) : (
        <button
          type="submit"
          disabled={isSendingMessage || !messageDraft.trim()}
          className="rounded-full bg-accent-3 px-4 py-3 text-xs font-semibold text-primary-background transition hover:brightness-110 disabled:opacity-60"
        >
          {isSendingMessage ? "Saving..." : editTargetMessageId ? "Save" : "Send"}
        </button>
      )}
    </form>
  );

  const activeOptionsTargetDepth = (() => {
    if (!activeOptionsMessage) {
      return 0;
    }
    let depth = 0;
    let cursor: ThreadMessage | undefined = activeOptionsMessage;
    let safety = 0;
    while (cursor?.parent_id && cursor.parent_id !== selectedThread.id && safety < 100) {
      depth += 1;
      const parentId = cursor.parent_id;
      cursor = messageById.get(parentId);
      safety += 1;
    }
    return depth;
  })();

  return (
    <div
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-primary-background"
    >
      <div className="flex items-center justify-between border-b border-accent-1 bg-secondary-background px-3 py-3">
        <BackButton onBack={onBack} backLabel="" textOnly />
        <div
          className="min-w-0 text-center flex items-center gap-2"
          onClick={setThreadSettingsOpen}
        >
          {selectedThread.image_url ? (
            <button
              type="button"
              className="h-10 w-10 shrink-0 rounded-full border-0 bg-transparent p-0"
              onClick={(event) => {
                event.stopPropagation();
                setImageViewer({
                  signedUrl: selectedThread.image_url!,
                  imageId: selectedThread.image_id ?? null,
                  alt: "Group photo",
                });
              }}
            >
              <CachedImage
                signedUrl={selectedThread.image_url}
                imageId={selectedThread.image_id ?? null}
                alt="Group photo"
                className="h-10 w-10 rounded-full border border-accent-1 object-cover"
              />
            </button>
          ) : (
            <div className="flex h-10 w-10 items-center justify-center">
              <Image className="h-10 w-10 text-accent-2" />
            </div>
          )}
          <p className="truncate text-sm font-semibold text-foreground">{selectedThread.name}</p>
        </div>
        <button
          type="button"
          aria-label="Start video call"
          onClick={() => setIsVideoCallOpen(true)}
          className="flex h-8 w-8 items-center justify-center rounded-full text-accent-2 hover:bg-accent-1/30 hover:text-foreground"
        >
          <Video className="h-4 w-4" />
        </button>
      </div>

      <div className="relative flex-1 min-h-0">
        <div
          ref={chatContainerRef}
          onScroll={onChatScroll}
          onTouchStart={(event) => {
            onTimestampSwipeStart(event);
            onBottomSwipeStart(event);
          }}
          onTouchMove={(event) => {
            onTimestampSwipeMove(event);
            onBottomSwipeMove(event);
          }}
          onTouchEnd={() => {
            onTimestampSwipeEnd();
            onBottomSwipeEnd();
          }}
          onTouchCancel={() => {
            onTimestampSwipeEnd();
            onBottomSwipeEnd();
          }}
          className="h-full min-h-0 space-y-2 overflow-x-hidden overflow-y-auto overscroll-contain px-3 py-3 touch-pan-y"
        >
          {isLoadingMessages ? (
            <div className="flex items-center gap-2 rounded-lg border border-accent-1 bg-secondary-background px-3 py-2">
              <span
                aria-hidden
                className="h-3 w-3 animate-spin rounded-full border-2 border-accent-2 border-t-transparent"
              />
              <p className="text-xs text-accent-2">Loading messages...</p>
            </div>
          ) : null}

          {isLoadingOlderMessages ? (
            <div className="flex items-center justify-center py-1">
              <span
                aria-hidden
                className="h-3 w-3 animate-spin rounded-full border-2 border-accent-2 border-t-transparent"
              />
            </div>
          ) : null}

          {!isLoadingMessages && messages.length === 0 ? (
            <p className="text-xs text-accent-2">No messages yet. Send the first one.</p>
          ) : null}

          <div
            className="space-y-2 transition-transform duration-75"
            style={{ transform: `translateX(${-messagesRevealOffsetPx}px)` }}
          >
            {rootMessages.map((message) => renderMessage(message, 0))}
          </div>
        </div>

        {showNewMessagesButton ? (
          <button
            type="button"
            onClick={() => {
              setShowNewMessagesButton(false);
              const container = chatContainerRef.current;
              if (!container) {
                return;
              }
              container.scrollTo({
                top: container.scrollHeight,
                behavior: "smooth",
              });
            }}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-accent-3 px-4 py-2 text-xs font-semibold text-primary-background shadow-lg shadow-black/30"
          >
            New messages
          </button>
        ) : null}
      </div>

      {isLoadingBottomSwipeRefresh ? (
        <div className="mx-3 mb-1 flex items-center justify-center gap-2 rounded-lg px-3 py-2">
          <span
            aria-hidden
            className="h-3 w-3 animate-spin rounded-full border-2 border-accent-2 border-t-transparent"
          />
          <p className="text-xs text-accent-2">Loading latest messages...</p>
        </div>
      ) : null}

      {editTargetMessageId && !activeOptionsMessageId ? (
        <div className="mx-2 mb-1 rounded-lg border border-accent-1 bg-secondary-background px-3 py-2 text-xs text-accent-2">
          Editing message
          <button
            type="button"
            onClick={() => {
              setEditTargetMessageId(null);
              setMessageDraft("");
              setIsComposerFocused(false);
            }}
            className="ml-2 p-2 underline underline-offset-2 hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      ) : null}

      <ImageViewerModal
        key={
          imageViewer
            ? `${imageViewer.signedUrl}-${imageViewer.imageId ?? ""}`
            : "image-viewer-closed"
        }
        open={imageViewer !== null}
        onClose={() => setImageViewer(null)}
        signedUrl={imageViewer?.signedUrl ?? null}
        imageId={imageViewer?.imageId ?? null}
        alt={imageViewer?.alt}
      />

      <CameraModal
        isOpen={isCameraModalOpen}
        onClose={() => setIsCameraModalOpen(false)}
        onSendPhoto={onSendPhotoFromCamera}
        isSending={isSendingMessage}
      />

      {isGamesModalOpen
        ? createPortal(
          <div
            className={`${DONT_SWIPE_TABS_CLASSNAME} fixed inset-0 z-[2100] flex items-end justify-center bg-black/45 px-3 pb-6 pt-16 sm:items-center`}
          >
            <button
              type="button"
              aria-label="Close games"
              className="absolute inset-0 cursor-default"
              onClick={() => setIsGamesModalOpen(false)}
            />
            <div className="relative z-10 w-full max-w-sm rounded-2xl border border-accent-1 bg-secondary-background p-4 shadow-xl">
              <p className="text-sm font-semibold text-foreground">Games</p>
              <p className="mt-1 text-xs text-accent-2">Start a turn-based game in this thread.</p>
              <button
                type="button"
                disabled={isSendingMessage || isLoadingMembers || members.length < 2}
                onClick={() => void startNewPoolGame()}
                className="mt-4 w-full rounded-xl border border-accent-1 bg-primary-background px-3 py-3 text-left text-sm font-medium text-foreground transition hover:border-accent-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="block">🎱 Pool</span>
                <span className="mt-0.5 block text-xs font-normal text-accent-2">
                  Top-down billiards — one shot per turn, state syncs in chat.
                </span>
              </button>
            </div>
          </div>,
          document.body,
        )
        : null}

      {activeOptionsMessage && activeOptionsMessageId
        ? createPortal(
          <div
            className={`${DONT_SWIPE_TABS_CLASSNAME} fixed inset-0 flex flex-col`}
            style={{ zIndex: MESSAGE_OPTIONS_OVERLAY_Z }}
            onClick={onMessageOptionsOverlayRootClick}
          >
            <div className="absolute inset-0 bg-black/35 backdrop-blur-md" aria-hidden />
            <div className="relative z-10 flex min-h-0 flex-1 flex-col pointer-events-none">
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Message options"
                className="pointer-events-auto flex min-h-0 flex-1 flex-col overflow-hidden"
              >
                {/** Upper half: emoji, held message, and actions — separate cards with gaps so blur shows through. */}
                <div className="flex max-h-[min(52vh,100%)] min-h-0 w-full flex-1 flex-col items-center justify-center overflow-y-auto overflow-x-hidden px-4 py-4">
                  <div className="flex w-full max-w-lg flex-col gap-0">
                    {/** Emojis row */}
                    <div className="w-full max-w-lg overflow-x-auto overflow-y-hidden [scrollbar-width:thin]">
                      <div className="mx-auto flex w-max flex-nowrap items-center justify-center gap-2 py-0.5">
                        {MESSAGE_OPTIONS_QUICK_EMOJIS.map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            className="flex h-7 w-7 shrink-0 items-center justify-center text-xl bg-transparent border-none"
                            aria-label={`React with ${emoji}`}
                            onClick={() => { onSendEmojiReply(activeOptionsMessage.id, emoji); }}
                          >
                            {emoji}
                          </button>
                        ))}
                        <EmojiPicker
                          onSelectEmoji={(emoji) => {
                            void onSendEmojiReply(activeOptionsMessage.id, emoji);
                          }}
                          className="shrink-0"
                          buttonClassName="flex h-11 w-11 shrink-0 items-center justify-center bg-transparent border-none"
                          buttonSmileIconClassName="h-5 w-5"
                        />
                      </div>
                    </div>

                    {/** Held message bubble */}
                    <div className="border-none bg-transparent px-3 py-3 shadow-lg">
                      <div
                        className={`flex w-full ${activeOptionsMessage.created_by === currentUserId ? "justify-end" : "justify-start"}`}
                      >
                        {renderOptionsTargetBubble(activeOptionsMessage, activeOptionsTargetDepth)}
                      </div>
                    </div>

                    {/** Actions row */}
                    <div className="flex flex-col gap-1 mt-4 rounded-2xl border border-accent-1 bg-secondary-background px-2 py-2 shadow-lg">
                      {activeOptionsMessage.created_by === currentUserId ? (
                        <button
                          type="button"
                          className="w-full border-b border-accent-1 px-4 py-1 text-left text-sm font-medium text-foreground"
                          onClick={() => {
                            setMessageDraft(activeOptionsMessage.text);
                            setEditTargetMessageId(activeOptionsMessage.id);
                            setReplyTargetMessageId(null);
                            setIsComposerFocused(true);
                            requestAnimationFrame(() => {
                              const area = composerTextareaRef.current;
                              area?.focus();
                              const len = area?.value.length ?? 0;
                              area?.setSelectionRange(len, len);
                            });
                          }}
                        >
                          Edit message
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="w-full border-none border-accent-1 px-4 py-1 text-left text-sm font-medium text-foreground"
                        onClick={() => { copyActiveOptionsMessage(activeOptionsMessage); }}
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                </div>
                <div className="pointer-events-auto mt-auto shrink-0 border-t border-accent-1 bg-primary-background pt-1">
                  {editTargetMessageId ? (
                    <div className="mx-2 mb-1 rounded-lg border border-accent-1 bg-secondary-background px-3 py-2 text-xs text-accent-2">
                      Editing message
                      <button
                        type="button"
                        onClick={() => {
                          setEditTargetMessageId(null);
                          setMessageDraft("");
                          setIsComposerFocused(false);
                          if (activeOptionsMessageId) {
                            setReplyTargetMessageId(activeOptionsMessageId);
                          }
                        }}
                        className="ml-2 p-2 underline underline-offset-2 hover:text-foreground"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : null}
                  {messageComposerForm}
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )
        : null}

      {!activeOptionsMessageId ? messageComposerForm : null}

      {statusMessage ? <p className="text-xs text-accent-2">{statusMessage}</p> : null}
    </div>
  );
}
