"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Camera, CircleUserRound, Image, Video } from "lucide-react";
import CameraModal from "@/app/components/Camera";
import CachedImage from "@/app/components/utils/CachedImage";
import { prepareImageForUpload } from "@/app/components/utils/client_file_storage_utils";
import UserSearch, { UserSearchOption } from "@/app/components/UserSearch";
import ThreadSettings from "@/app/components/ThreadSettings";
import VideoCall from "@/app/components/VideoCall";
import {
  ApiError,
  FriendSearchResponse,
  ImageOverlayData,
  MessageData,
  SyncEvent,
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
import useSwipeBack from "./utils/useSwipeBack";

type ThreadProps = {
  thread: ThreadItem;
  currentUserId: string;
  onBack: () => void;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const BOTTOM_FOLLOW_THRESHOLD_PX = 80;

const THREAD_MESSAGES_CACHE_KEY_PREFIX = "thread_messages_v1_";

type ThreadMessagesCachePayload = ThreadMessagesResponse & {
  cached_at: number;
};

const isNearBottom = (element: HTMLDivElement): boolean =>
  element.scrollHeight - element.scrollTop - element.clientHeight < BOTTOM_FOLLOW_THRESHOLD_PX;
const postWithAuth = async (path: string, body: unknown): Promise<Response> => {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json"},
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

export default function Thread({ thread, currentUserId, onBack }: ThreadProps) {
  const [activeThread, setActiveThread] = useState<ThreadItem>(thread);
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
  const isFollowingBottomRef = useRef(true);
  const [showNewMessagesButton, setShowNewMessagesButton] = useState(false);
  const [replyTargetMessageId, setReplyTargetMessageId] = useState<string | null>(null);
  const [editTargetMessageId, setEditTargetMessageId] = useState<string | null>(null);
  const [activeOptionsMessageId, setActiveOptionsMessageId] = useState<string | null>(null);
  const [expandedReplyRootIds, setExpandedReplyRootIds] = useState<string[]>([]);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const pendingBottomScrollRef = useRef<ScrollBehavior | null>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { onTouchStart, onTouchEnd } = useSwipeBack({ onBack });

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

    setActiveThread(thread);
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

    const loadThread = async () => {
      setIsLoadingMessages(true);
      setIsLoadingMembers(true);

      try {
        const cached = await readThreadMessagesCache(thread.id);
        if (!isCancelled && cached) {
          setActiveThread((previousThread) => ({
            ...previousThread,
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
            setActiveThread((previousThread) => ({
              ...previousThread,
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
  }, [thread, readThreadMessagesCache, writeThreadMessagesCache]);

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
        thread_id: activeThread.id,
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
              event.thread_id === activeThread.id,
          );

          if (!needsThreadRefresh) {
            continue;
          }

          const container = chatContainerRef.current;
          const wasNearBottom = container ? isNearBottom(container) : false;

          const latestResponse = await postWithAuth("/api/thread-messages", {
            thread_id: activeThread.id,
          });

          if (!latestResponse.ok) {
            continue;
          }

          const latestPayload = (await latestResponse.json()) as ThreadMessagesResponse;

          setMessages((previousMessages) =>
            mergeMessagesById(previousMessages, latestPayload.messages),
          );
          setHasMoreOlderMessages((previousValue) => previousValue || latestPayload.has_more_older);
          setOldestLoadedMessageId(
            (previousCursorId) => previousCursorId ?? latestPayload.next_cursor_message_id,
          );

          void writeThreadMessagesCache(activeThread.id, latestPayload);

          if (wasNearBottom) {
            pendingBottomScrollRef.current = "smooth";
            setShowNewMessagesButton(false);
          isFollowingBottomRef.current = true;
          } else {
            setShowNewMessagesButton(true);
          isFollowingBottomRef.current = false;
          }
        } catch {
          await sleep(1_000);
        }
      }
    };

    void pollSyncEvents();

    return () => {
      isCancelled = true;
    };
  }, [activeThread.id, currentUserId]);

  const sendThreadMessage = async ({
    text,
    imageBase64Data,
    imageMimeType,
    imagePreviewDataUrl,
    imageOverlay,
    clearDraftOnSuccess,
  }: {
    text: string;
    imageBase64Data?: string;
    imageMimeType?: string;
    imagePreviewDataUrl?: string;
    imageOverlay?: ImageOverlayData;
    clearDraftOnSuccess?: boolean;
  }): Promise<void> => {
    setIsSendingMessage(true);
    setStatusMessage("");

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
        thread_id: activeThread.id,
        text: trimmedText,
        ...(replyTargetMessageId ? { reply_to_message_id: replyTargetMessageId } : {}),
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
      if (replyTargetMessageId) {
        const rootMessageId = getRootMessageIdForMessage(replyTargetMessageId);
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

  const visibleMessages = messages.filter((message) => {
    const hasText = message.text.trim().length > 0;
    const hasImage = Boolean(message.image_url);
    const hasOverlay = Boolean(toImageOverlayData(message.data));
    // Hide pure signaling / data-only messages (e.g., video call signals) from the chat UI.
    return hasText || hasImage || hasOverlay;
  });

  const rootMessages = visibleMessages.filter((message) => message.parent_id === activeThread.id);
  const childMessagesByParentId = new Map<string, ThreadMessage[]>();
  for (const message of visibleMessages) {
    if (!message.parent_id || message.parent_id === activeThread.id) {
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
      if (cursor.parent_id === activeThread.id) {
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
        thread_id: activeThread.id,
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

  const renderMessage = (message: ThreadMessage, depth: number) => {
    const isOwnMessage = message.created_by === currentUserId;
    const hasText = message.text.trim().length > 0;
    const hasImage = Boolean(message.image_url);
    const isImageOnly = hasImage && !hasText;
    const messageImageOverlay = toImageOverlayData(message.data);
    const rootMessageId = getRootMessageIdForMessage(message.id);
    const children = childMessagesByParentId.get(message.id) ?? [];
    const isRootMessage = rootMessageId === message.id;
    const isRootRepliesExpanded =
      rootMessageId !== null && expandedReplyRootIds.includes(rootMessageId);

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
          onContextMenu={(event) => {
            event.preventDefault();
            setActiveOptionsMessageId(message.id);
          }}
          className={`max-w-[85%] text-sm ${
            isImageOnly
              ? `${isOwnMessage ? "ml-auto" : ""}`
              : `rounded-2xl px-3 py-1 shadow-sm ${
                  isOwnMessage
                    ? "ml-auto rounded-br-sm bg-accent-3 text-primary-background"
                    : "rounded-bl-sm bg-secondary-background text-foreground"
                }`
          } ${depth > 0 ? "ml-5 border-l border-accent-1/60" : ""}`}
          style={depth > 0 ? { width: "calc(85% - 1.25rem)" } : undefined}
        >
          {!isImageOnly ? (
            <>
              <p className="text-[10px] opacity-60">{isOwnMessage ? "You" : message.username}</p>
              <p className="break-words">{message.text}</p>
            </>
          ) : null}
          {message.image_url ? (
            <div className={`relative ${!isImageOnly ? "mt-1" : ""}`}>
            <CachedImage
              signedUrl={message.image_url}
              imageId={message.image_id}
              alt="Thread message attachment"
              className="max-h-[100vh] w-full rounded-xl object-cover"
              loading="lazy"
              onLoad={handleMessageImageLoad}
            />
              {messageImageOverlay ? (
                <div
                  className="absolute left-0 right-0 -translate-y-1/2 bg-black/45 px-3 py-2 text-center text-sm font-semibold text-white"
                  style={{ top: `${messageImageOverlay.y_ratio * 100}%` }}
                >
                  {messageImageOverlay.text}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {isRootMessage && children.length > 0 ? (
          <button
            type="button"
            onClick={() => toggleRepliesForRootMessageId(message.id)}
            className="mt-1 ml-1 text-xs text-accent-2 underline underline-offset-2 hover:text-foreground"
          >
            {isRootRepliesExpanded ? "Hide replies" : `${children.length} replies`}
          </button>
        ) : null}

        {children.length > 0 ? (
          <div className="mt-1 mx-2 space-y-1 border-l border-r border-accent-1/60">
            {children.map((childMessage) => renderMessage(childMessage, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  };

  const isOwner = activeThread.owner_user_id === currentUserId;
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

  if (isVideoCallOpen) {
    return (
      <VideoCall
        threadId={activeThread.id}
        currentUserId={currentUserId}
        onBack={() => setIsVideoCallOpen(false)}
      />
    );
  }
  

  if (isSettingsOpen) {
    return (
      <ThreadSettings
        thread={activeThread}
        currentUserId={currentUserId}
        onBack={() => setIsSettingsOpen(false)}
        onThreadImageUpdated={(imageId, imageUrl) => {
          setActiveThread((previous) => ({
            ...previous,
            image_id: imageId,
            image_url: imageUrl,
          }));
        }}
        onThreadRenamed={(name) => {
          setActiveThread((previous) => ({
            ...previous,
            name,
          }));
        }}
      />
    );
  }

  return (
    <div
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-primary-background"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="flex items-center justify-between border-b border-accent-1 bg-secondary-background px-3 py-3">
        <BackButton onBack={onBack} backLabel="Groups" />
        <div
          className="min-w-0 text-center flex items-center gap-2"
          onClick={() => setIsSettingsOpen((previous) => !previous)}
        >
           {activeThread.image_url ? (
            <CachedImage
              signedUrl={activeThread.image_url}
              imageId={activeThread.image_id ?? null}
              alt="Group photo"
              className="h-10 w-10 rounded-full border border-accent-1 object-cover"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center">
              <Image className="h-10 w-10 text-accent-2" />
            </div>
          )}
          <p className="truncate text-sm font-semibold text-foreground">{activeThread.name}</p>
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

      {activeOptionsMessageId ? (
        <div className="mx-2 mb-1 rounded-xl border border-accent-1 bg-secondary-background p-2 text-xs text-foreground">
          <p className="mb-2 text-accent-2">Message options</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setReplyTargetMessageId(activeOptionsMessageId);
                setEditTargetMessageId(null);
                setActiveOptionsMessageId(null);
              }}
              className="rounded-lg border border-accent-1 px-2 py-1 text-accent-2 hover:text-foreground"
            >
              Reply
            </button>
            {messageById.get(activeOptionsMessageId)?.created_by === currentUserId ? (
              <button
                type="button"
                onClick={() => {
                  const activeMessage = messageById.get(activeOptionsMessageId);
                  if (activeMessage) {
                    setMessageDraft(activeMessage.text);
                    setEditTargetMessageId(activeMessage.id);
                    setReplyTargetMessageId(null);
                  }
                  setActiveOptionsMessageId(null);
                }}
                className="rounded-lg border border-accent-1 px-2 py-1 text-accent-2 hover:text-foreground"
              >
                Edit
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setActiveOptionsMessageId(null)}
              className="rounded-lg border border-accent-1 px-2 py-1 text-accent-2 hover:text-foreground"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

      {replyTargetMessageId ? (
        <div className="mx-2 mb-1 rounded-lg border border-accent-1 bg-secondary-background px-3 py-2 text-xs text-accent-2">
          Replying to: {messageById.get(replyTargetMessageId)?.text ?? "message"}
          <button
            type="button"
            onClick={() => setReplyTargetMessageId(null)}
            className="ml-2 underline underline-offset-2 hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      ) : null}

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
            className="ml-2 underline underline-offset-2 hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      ) : null}

      <CameraModal
        isOpen={isCameraModalOpen}
        onClose={() => setIsCameraModalOpen(false)}
        onSendPhoto={onSendPhotoFromCamera}
        isSending={isSendingMessage}
      />

      <form onSubmit={onSendMessage} className="mx-2 mb-2 mt-1 flex items-center gap-2">
        <input
          className={`rounded-full border border-accent-1 bg-secondary-background px-4 py-2 text-sm text-foreground outline-none focus:border-accent-2 transition-all duration-200 ${
            isComposerExpanded ? "flex-1" : "w-1/2"
          }`}
          placeholder="Type a message..."
          value={messageDraft}
          onChange={(event) => setMessageDraft(event.target.value)}
          onFocus={() => setIsComposerFocused(true)}
          onBlur={() => {
            if (!messageDraft.trim() && !editTargetMessageId) {
              setIsComposerFocused(false);
            }
          }}
        />
        {!isComposerExpanded ? (
          <button
            type="button"
            onClick={() => {
              openCameraModal();
            }}
            disabled={Boolean(editTargetMessageId)}
            className="flex-1 rounded-full border border-accent-1 px-3 py-2 text-xs font-semibold text-accent-2 transition hover:text-foreground disabled:opacity-50"
            aria-label="Take photo"
          >
            <Camera className="mx-auto h-4 w-4" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={isSendingMessage || !messageDraft.trim()}
            className="rounded-full bg-accent-3 px-4 py-2 text-xs font-semibold text-primary-background transition hover:brightness-110 disabled:opacity-60"
          >
            {isSendingMessage ? "Saving..." : editTargetMessageId ? "Save" : "Send"}
          </button>
        )}
      </form>

      {statusMessage ? <p className="text-xs text-accent-2">{statusMessage}</p> : null}
    </div>
  );
}
