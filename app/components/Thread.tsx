"use client";

import {
  FormEvent,
  KeyboardEvent,
  SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
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
import { linkifyHttpsText } from "@/app/components/utils/linkifyHttpsText";
import { DONT_SWIPE_TABS_CLASSNAME } from "@/app/components/utils/useSwipeBack";
import ImageViewerModal from "@/app/components/ImageViewerModal";
import CachedImage from "@/app/components/utils/CachedImage";
import EmojiPicker from "@/app/components/utils/EmojiPicker";
import { prepareImageForUpload } from "@/app/components/utils/client_file_storage_utils";
import VideoCall from "@/app/components/VideoCall";
import {
  ApiError,
  ImageOverlayData,
  MessageData,
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
const EMOJI_ONLY_MESSAGE_REGEX =
  /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\uFE0F|\u200D|\s)+$/u;
const HAS_EMOJI_REGEX = /\p{Extended_Pictographic}/u;

const THREAD_MESSAGES_CACHE_KEY_PREFIX = "thread_messages_v1_";

type ThreadMessagesCachePayload = ThreadMessagesResponse & {
  cached_at: number;
};

const isNearBottom = (element: HTMLDivElement): boolean =>
  element.scrollHeight - element.scrollTop - element.clientHeight < BOTTOM_FOLLOW_THRESHOLD_PX;
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
  return Boolean(trimmed) && EMOJI_ONLY_MESSAGE_REGEX.test(trimmed) && HAS_EMOJI_REGEX.test(trimmed);
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
  const [expandedReplyRootIds, setExpandedReplyRootIds] = useState<string[]>([]);
  const [imageViewer, setImageViewer] = useState<{
    signedUrl: string;
    imageId: string | null;
    alt: string;
  } | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingBottomScrollRef = useRef<ScrollBehavior | null>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesRef = useRef<ThreadMessage[]>([]);

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
    };
  }, []);

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
        const rootMessageId = getRootMessageIdForMessage(effectiveReplyTargetMessageId);
        if (rootMessageId) {
          setExpandedReplyRootIds((previous) =>
            previous.includes(rootMessageId) ? previous : [...previous, rootMessageId],
          );
        }
      }
      setReplyTargetMessageId(null);
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

  const getRootMessageIdForMessage = (messageId: string): string | null => {
    let cursor = messageById.get(messageId);
    let safety = 0;
    while (cursor && cursor.parent_id && safety < 100) {
      if (cursor.parent_id === selectedThread.id) {
        return cursor.id;
      }
      cursor = messageById.get(cursor.parent_id);
      safety += 1;
    }
    return null;
  };

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
    }, 1_000);
  };

  const toggleRepliesForRootMessageId = (rootMessageId: string) => {
    setExpandedReplyRootIds((previous) =>
      previous.includes(rootMessageId)
        ? previous.filter((id) => id !== rootMessageId)
        : [...previous, rootMessageId],
    );
  };

  const onEditMessage = async () => {
    if (!editTargetMessageId || !messageDraft.trim()) {
      return;
    }

    setIsSendingMessage(true);
    setStatusMessage("");

    try {
      const response = await postWithAuth("/api/thread-edit", {
        thread_id: selectedThread.id,
        message_id: editTargetMessageId,
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

  const renderMessage = (message: ThreadMessage, depth: number) => {
    const isOwnMessage = message.created_by === currentUserId;
    const hasText = message.text.trim().length > 0;
    const hasImage = Boolean(message.image_url);
    const isImageOnly = hasImage && !hasText;
    const messageImageOverlay = toImageOverlayData(message.data);
    const poolGame = getPoolGameFromMessageData(message.data);
    const showPoolCard = poolGame && latestPoolMessageIds.has(message.id);

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
        <div key={message.id} className="max-w-[85%]">
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
        </div>
      );
    }

    const rootMessageId = getRootMessageIdForMessage(message.id);
    const children = childMessagesByParentId.get(message.id) ?? [];
    const emojiOnlyChildren = children.filter((childMessage) => isEmojiOnlyMessage(childMessage.text));
    const threadedChildren = children.filter((childMessage) => !isEmojiOnlyMessage(childMessage.text));
    const isRootMessage = rootMessageId === message.id;
    const isRootRepliesExpanded =
      rootMessageId !== null && expandedReplyRootIds.includes(rootMessageId);
    const isActiveOptionsMessage = activeOptionsMessageId === message.id;
    const isReplyTargetMessage = replyTargetMessageId === message.id;

    if (depth > 0 && !isRootRepliesExpanded) {
      return null;
    }

    return (
      <div key={message.id}>
        <div
          onMouseDown={() => startLongPress(message.id)}
          onMouseUp={cancelPressTimer}
          onMouseLeave={cancelPressTimer}
          onTouchStart={() => startLongPress(message.id)}
          onTouchEnd={cancelPressTimer}
          onTouchMove={cancelPressTimer}
          onTouchCancel={cancelPressTimer}
          onContextMenu={(event) => {
            event.preventDefault();
            setActiveOptionsMessageId(message.id);
          }}
          className={`max-w-[85%] select-none text-sm ${isImageOnly
            ? `${isOwnMessage ? "ml-auto" : ""}`
            : `rounded-2xl px-3 py-1 shadow-sm ${isOwnMessage
              ? "ml-auto rounded-br-sm bg-accent-3 text-primary-background"
              : "rounded-bl-sm bg-secondary-background text-foreground"
            }`
            } ${depth > 0 ? "ml-5 border-l border-accent-1/60" : ""}`}
          style={depth > 0 ? { width: "calc(85% - 1.25rem)" } : undefined}
        >
          {!isImageOnly ? (
            <>
              <p className="text-xs opacity-60 [-webkit-touch-callout:none]">
                {isOwnMessage ? "You" : message.username}
              </p>
              <p className="break-words [-webkit-touch-callout:none]">{linkifyHttpsText(message.text)}</p>
            </>
          ) : null}
          {message.image_url ? (
            <div className={`relative ${!isImageOnly ? "mt-1" : ""}`}>
              <button
                type="button"
                className="block w-full cursor-zoom-in rounded-xl border-0 bg-transparent p-0"
                onClick={(event) => {
                  event.stopPropagation();
                  setImageViewer({
                    signedUrl: message.image_url!,
                    imageId: message.image_id,
                    alt: "Thread message attachment",
                  });
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onTouchStart={(event) => event.stopPropagation()}
              >
                <CachedImage
                  signedUrl={message.image_url}
                  imageId={message.image_id}
                  alt="Thread message attachment"
                  className="max-h-[100vh] w-full rounded-xl object-cover"
                  loading="lazy"
                  onLoad={handleMessageImageLoad}
                />
              </button>
              {messageImageOverlay ? (
                <div
                  className="pointer-events-none absolute left-0 right-0 -translate-y-1/2 bg-black/45 px-3 py-2 text-center text-sm font-semibold text-white"
                  style={{ top: `${messageImageOverlay.y_ratio * 100}%` }}
                >
                  {messageImageOverlay.text}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {emojiOnlyChildren.length > 0 ? (
          <div className="mt-1 ml-1 flex flex-wrap items-center gap-1">
            {emojiOnlyChildren.map((childMessage) => (
              <span key={childMessage.id} className="text-base leading-none">
                {childMessage.text.trim()}
              </span>
            ))}
          </div>
        ) : null}

        {isRootMessage && threadedChildren.length > 0 ? (
          <button
            type="button"
            onClick={() => toggleRepliesForRootMessageId(message.id)}
            className="mt-1 ml-1 text-xs text-accent-2 underline underline-offset-2 hover:text-foreground"
          >
            {isRootRepliesExpanded ? "Hide replies" : `${threadedChildren.length} replies`}
          </button>
        ) : null}

        {threadedChildren.length > 0 ? (
          <div className="mt-1 mx-2 space-y-1 border-l border-r border-accent-1/60">
            {threadedChildren.map((childMessage) => renderMessage(childMessage, depth + 1))}
          </div>
        ) : null}

        {isActiveOptionsMessage ? (
          <div
            className="mt-1 ml-1 mr-2 rounded-xl border border-accent-1 bg-secondary-background p-2 text-xs text-foreground"
            style={{ boxShadow: "0 0 10px 0 rgba(246, 243, 50, 0.88)" }}
          >
            <p className="mb-2 text-accent-2 p-2">Message options</p>
            <div className="flex flex-wrap gap-2 w-full">
              <button
                type="button"
                onClick={() => {
                  setReplyTargetMessageId(message.id);
                  setEditTargetMessageId(null);
                  setActiveOptionsMessageId(null);
                }}
                className="flex-1 rounded-lg border border-accent-1 px-4 py-2 hover:text-foreground"
              >
                Reply
              </button>
              <EmojiPicker
                onSelectEmoji={(emoji) => {
                  void onSendEmojiReply(message.id, emoji);
                }}
                className="flex-1"
                buttonClassName="h-full w-full rounded-lg border border-accent-1 px-4 py-2"
              />
              {isOwnMessage ? (
                <button
                  type="button"
                  onClick={() => {
                    setMessageDraft(message.text);
                    setEditTargetMessageId(message.id);
                    setReplyTargetMessageId(null);
                    setActiveOptionsMessageId(null);
                  }}
                  className="flex-1 rounded-lg border border-accent-1 px-4 py-2 hover:text-foreground"
                >
                  Edit
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setActiveOptionsMessageId(null)}
                className="flex-1 rounded-lg border border-accent-1 px-4 py-2 hover:text-foreground"
              >
                Close
              </button>
            </div>
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

  const isOwner = selectedThread.owner_user_id === currentUserId;
  const isComposerExpanded =
    isComposerFocused || Boolean(editTargetMessageId) || messageDraft.trim().length > 0;

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


  // if (isSettingsOpen) {
  //   return (
  //     <ThreadSettings
  //       thread={selectedThread}
  //       currentUserId={currentUserId}
  //       onBack={() => {
  //         setIsSettingsOpen(false);
  //       }}
  //       onThreadImageUpdated={(imageId, imageUrl) => {
  //         setSelectedThread((previous: ThreadItem | null) => ({
  //           ...previous as ThreadItem,
  //           image_id: imageId,
  //           image_url: imageUrl,
  //         }));
  //       }}
  //       onThreadRenamed={(name) => {
  //         setSelectedThread((previous: ThreadItem | null) => ({
  //           ...previous as ThreadItem,
  //           name,
  //         }));
  //       }}
  //     />
  //   );
  // }

  return (
    <div
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-primary-background"
    >
      <div className="flex items-center justify-between border-b border-accent-1 bg-secondary-background px-3 py-3">
        <BackButton onBack={onBack} backLabel="Groups" />
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
          className="h-full min-h-0 space-y-2 overflow-y-auto overscroll-contain px-3 py-3 touch-pan-y"
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

          {rootMessages.map((message) => renderMessage(message, 0))}
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

      {editTargetMessageId ? (
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

      <form onSubmit={onSendMessage} className="mx-2 mb-2 mt-1 flex items-end gap-2">
        {/** Main message input */}
        <textarea
          ref={composerTextareaRef}
          rows={1}
          className={`min-h-10 resize-none overflow-hidden rounded-2xl border border-accent-1 bg-secondary-background px-4 py-2 text-sm leading-normal text-foreground break-words outline-none focus:border-accent-2 transition-[border-color] duration-200 ${isComposerExpanded ? "flex-1" : "w-1/2"
            }`}
          placeholder="Type a message..."
          value={messageDraft}
          onChange={(event) => setMessageDraft(event.target.value)}
          onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
            if (event.key !== "Enter" || event.shiftKey) {
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

        {/** Camera button & Plus Games button */}
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
          <>
            <button
              type="submit"
              disabled={isSendingMessage || !messageDraft.trim()}
              className="rounded-full bg-accent-3 px-4 py-3 text-xs font-semibold text-primary-background transition hover:brightness-110 disabled:opacity-60"
            >
              {isSendingMessage ? "Saving..." : editTargetMessageId ? "Save" : "Send"}
            </button>
          </>
        )}
      </form>

      {statusMessage ? <p className="text-xs text-accent-2">{statusMessage}</p> : null}
    </div>
  );
}
