"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import CameraModal from "@/app/components/Camera";
import { prepareImageForUpload } from "@/app/components/client_file_storage_utils";
import UserSearch, { UserSearchOption } from "@/app/components/UserSearch";

export type ThreadItem = {
  id: string;
  name: string;
  created_at: string;
  owner_user_id: string;
  owner_username: string;
};

type ThreadProps = {
  thread: ThreadItem;
  currentUserId: string;
  onBack: () => void;
};

type ThreadMessage = {
  id: string;
  text: string;
  created_at: string;
  created_by: string;
  parent_id: string | null;
  image_id: string | null;
  image_url: string | null;
  data: MessageData | null;
  direct_reply_count: number;
  username: string;
};

type ImageOverlayData = {
  text: string;
  y_ratio: number;
};

type MessageData = {
  image_overlay?: ImageOverlayData;
};

type ThreadMember = {
  user_id: string;
  username: string;
  email: string | null;
  is_owner: boolean;
};

type FriendSearchResult = {
  id: string;
  username: string;
  email: string | null;
};

type ApiError = {
  error?: {
    code?: string;
    message?: string;
  };
};

type SyncEvent = {
  id: string;
  type: "thread_message_posted" | "thread_message_updated";
  thread_id: string;
  message_id: string;
  created_by: string;
};

const AUTH_TOKEN_KEY = "auth_token";
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const BOTTOM_FOLLOW_THRESHOLD_PX = 80;

const isNearBottom = (element: HTMLDivElement): boolean =>
  element.scrollHeight - element.scrollTop - element.clientHeight < BOTTOM_FOLLOW_THRESHOLD_PX;
const postWithAuth = async (path: string, body: unknown): Promise<Response> => {
  const token = window.localStorage.getItem(AUTH_TOKEN_KEY);
  if (!token) {
    throw new Error("Not authenticated.");
  }

  return fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
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
  const [memberFormError, setMemberFormError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [showNewMessagesButton, setShowNewMessagesButton] = useState(false);
  const [replyTargetMessageId, setReplyTargetMessageId] = useState<string | null>(null);
  const [editTargetMessageId, setEditTargetMessageId] = useState<string | null>(null);
  const [activeOptionsMessageId, setActiveOptionsMessageId] = useState<string | null>(null);
  const [expandedReplyRootIds, setExpandedReplyRootIds] = useState<string[]>([]);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const pendingBottomScrollRef = useRef<ScrollBehavior | null>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const readErrorMessage = async (response: Response): Promise<string> => {
    try {
      const body = (await response.json()) as ApiError;
      return body.error?.message ?? "Request failed.";
    } catch {
      return "Request failed.";
    }
  };

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
        const response = await postWithAuth("/api/thread-messages", { thread_id: thread.id });
        if (!response.ok) {
          setStatusMessage(await readErrorMessage(response));
          setMessages([]);
        } else {
          const payload = (await response.json()) as {
            thread: { name: string; owner_user_id: string };
            has_more_older: boolean;
            next_cursor_message_id: string | null;
            messages: ThreadMessage[];
          };

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
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : "Failed to load thread.");
        setMessages([]);
      } finally {
        setIsLoadingMessages(false);
      }

      try {
        const membersResponse = await postWithAuth("/api/thread-members", { thread_id: thread.id });
        if (!membersResponse.ok) {
          setStatusMessage(await readErrorMessage(membersResponse));
          setMembers([]);
          return;
        }

        const membersPayload = (await membersResponse.json()) as { members: ThreadMember[] };
        setMembers(membersPayload.members);
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : "Failed to load members.");
        setMembers([]);
      } finally {
        setIsLoadingMembers(false);
      }
    };

    void loadThread();
  }, [thread]);

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

      const payload = (await response.json()) as {
        has_more_older: boolean;
        next_cursor_message_id: string | null;
        messages: ThreadMessage[];
      };

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

          const payload = (await syncResponse.json()) as { events: SyncEvent[] };
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

          const latestPayload = (await latestResponse.json()) as {
            has_more_older: boolean;
            next_cursor_message_id: string | null;
            messages: ThreadMessage[];
          };

          setMessages((previousMessages) =>
            mergeMessagesById(previousMessages, latestPayload.messages),
          );
          setHasMoreOlderMessages((previousValue) => previousValue || latestPayload.has_more_older);
          setOldestLoadedMessageId(
            (previousCursorId) => previousCursorId ?? latestPayload.next_cursor_message_id,
          );

          if (wasNearBottom) {
            pendingBottomScrollRef.current = "smooth";
            setShowNewMessagesButton(false);
          } else {
            setShowNewMessagesButton(true);
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

      const payload = (await response.json()) as { message: ThreadMessage };
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

  const onAddMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!memberIdentifier.trim()) {
      return;
    }

    setIsUpdatingMembers(true);
    setMemberFormError("");
    setStatusMessage("");

    try {
      const response = await postWithAuth("/api/thread-member-add", {
        thread_id: activeThread.id,
        identifier: memberIdentifier,
      });
      if (!response.ok) {
        setMemberFormError(await readErrorMessage(response));
        return;
      }

      const payload = (await response.json()) as { member: ThreadMember };
      setMembers((previousMembers) => {
        const exists = previousMembers.some((member) => member.user_id === payload.member.user_id);
        if (exists) {
          return previousMembers;
        }
        return [...previousMembers, payload.member];
      });
      setMemberIdentifier("");
      setMemberFormError("");
    } catch (error) {
      setMemberFormError(error instanceof Error ? error.message : "Failed to add member.");
    } finally {
      setIsUpdatingMembers(false);
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

  const onRemoveMember = async (userId: string) => {
    setIsUpdatingMembers(true);
    setStatusMessage("");

    try {
      const response = await postWithAuth("/api/thread-member-remove", {
        thread_id: activeThread.id,
        user_id: userId,
      });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }
      setMembers((previousMembers) =>
        previousMembers.filter((member) => member.user_id !== userId),
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to remove member.");
    } finally {
      setIsUpdatingMembers(false);
    }
  };

  const searchThreadMemberOptions = useCallback(
    async (query: string): Promise<UserSearchOption[]> => {
      const response = await postWithAuth("/api/friend-search", { query });
      if (!response.ok) {
        return [];
      }

      const payload = (await response.json()) as {
        users: Array<FriendSearchResult & { relation?: unknown }>;
      };
      return payload.users.map((user) => ({
        id: user.id,
        username: user.username,
        email: user.email,
      }));
    },
    [],
  );

  const messageById = new Map(messages.map((message) => [message.id, message]));
  const rootMessages = messages.filter((message) => message.parent_id === activeThread.id);
  const childMessagesByParentId = new Map<string, ThreadMessage[]>();
  for (const message of messages) {
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

      const payload = (await response.json()) as { message: ThreadMessage };
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
              <img
                src={message.image_url}
                alt="Thread message attachment"
                className="max-h-56 w-full rounded-xl object-cover"
                loading="lazy"
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
          <div className="mt-1 space-y-1">
            {children.map((childMessage) => renderMessage(childMessage, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  };

  const isOwner = activeThread.owner_user_id === currentUserId;
  const isComposerExpanded =
    isComposerFocused ||
    Boolean(editTargetMessageId) ||
    messageDraft.trim().length > 0;

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-primary-background">
      <div className="flex items-center justify-between border-b border-accent-1 bg-secondary-background px-3 py-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-full border border-accent-1 bg-primary-background px-3 py-1.5 text-xs font-medium text-accent-2 transition hover:text-foreground"
        >
          {"<"}
        </button>
        <div className="min-w-0 text-center">
          <p className="truncate text-sm font-semibold text-foreground">{activeThread.name}</p>
        </div>
        <button
          type="button"
          onClick={() => setIsSettingsOpen((previous) => !previous)}
          disabled={!isOwner}
          className="rounded-full border border-accent-1 bg-primary-background px-3 py-1.5 text-xs font-medium text-accent-2 transition hover:text-foreground disabled:opacity-50"
        >
          Settings
        </button>
      </div>

      {isOwner && isSettingsOpen ? (
        <section className="mx-2 mt-2 rounded-xl border border-accent-1 bg-secondary-background p-3">
          <div className="space-y-3">
            <form onSubmit={onAddMember} className="flex items-center gap-2">
              <div className="flex-1">
                <UserSearch
                  value={memberIdentifier}
                  onValueChange={(value) => {
                    setMemberIdentifier(value);
                    if (memberFormError) {
                      setMemberFormError("");
                    }
                  }}
                  onSelect={(option) => {
                    setMemberIdentifier(option.username);
                    if (memberFormError) {
                      setMemberFormError("");
                    }
                  }}
                  searchUsers={searchThreadMemberOptions}
                  placeholder="Username or email"
                  inputClassName="w-full rounded-xl border border-accent-1 bg-secondary-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent-2"
                />
                {memberFormError ? (
                  <p className="mt-1 text-xs text-accent-2">{memberFormError}</p>
                ) : null}
              </div>
              <button
                type="submit"
                disabled={isUpdatingMembers}
                className="rounded-xl bg-accent-3 px-3 py-2 text-xs font-semibold text-primary-background transition hover:brightness-110 disabled:opacity-60"
              >
                Add
              </button>
            </form>

            <div className="space-y-2">
              {isLoadingMembers ? <p className="text-xs text-accent-2">Loading members...</p> : null}

              {!isLoadingMembers && members.length === 0 ? (
                <p className="text-xs text-accent-2">No members found.</p>
              ) : null}

              {members.map((member) => (
                <div
                  key={member.user_id}
                  className="flex items-center justify-between rounded-lg border border-accent-1 bg-secondary-background px-3 py-2"
                >
                  <div>
                    <p className="text-sm text-foreground">
                      {member.username} {member.is_owner ? "(owner)" : ""}
                    </p>
                    <p className="text-xs text-accent-2">{member.email ?? "No email"}</p>
                  </div>
                  {!member.is_owner ? (
                    <button
                      type="button"
                      onClick={() => {
                        void onRemoveMember(member.user_id);
                      }}
                      disabled={isUpdatingMembers}
                      className="rounded-lg border border-accent-1 px-2 py-1 text-xs text-accent-2 transition hover:text-foreground disabled:opacity-60"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

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
