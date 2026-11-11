"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import EventDateTimeSelect, {
  defaultCreateEventSchedule,
  EventScheduleFields,
  eventLocalDatetimeToDate,
  isoToEventLocalDatetime,
  scheduleModeForRange,
  type EventScheduleMode,
} from "@/app/components/EventDateTimeSelect";
import { AddImageIcon, CloseIcon, DeleteIcon } from "@/app/components/Icons";
import UserProfileImage from "@/app/components/UserProfileImage";
import UserSearch, { type UserSearchOption } from "@/app/components/UserSearch";
import AnimatedModal from "@/app/components/utils/AnimatedModal";
import CachedImage from "@/app/components/utils/CachedImage";
import { prepareImageForUpload } from "@/app/components/utils/client_file_storage_utils";
import { Button, IconButton } from "@/app/ui-components";
import type {
  ApiError,
  EventCreateRequest,
  EventCreateResponse,
  FriendSearchResponse,
  ThreadEventBackgroundSetRequest,
  ThreadEventBackgroundSetResponse,
  ThreadEventDeleteResponse,
  ThreadEventItem,
  ThreadEventUpdateRequest,
  ThreadEventUpdateResponse,
  UserUpcomingEventListItem,
} from "@/app/types/interfaces";

type BackgroundSelection =
  | { kind: "default"; key: string }
  | { kind: "upload"; base64Data: string; mimeType: string; previewUrl: string };

type DefaultBackgroundOption = {
  key: string;
  label: string;
  url: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CLOSE_AFTER_DAYS = 3;
const DEFAULT_RELEASE_AFTER_DAYS = 7;

const localDatetimeInDays = (days: number): string =>
  isoToEventLocalDatetime(new Date(Date.now() + days * DAY_MS).toISOString());

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

type EventEditorModalProps = {
  isPresented: boolean;
  isClosing: boolean;
  isActive: boolean;
  onClose: () => void;
  mode: "create" | "edit";
  currentUserId: string;
  /** Required when mode is "edit". */
  event?: ThreadEventItem;
  /** Owner-only invite UI in edit mode. */
  canInvite?: boolean;
  existingMemberUserIds?: string[];
  onCreated?: (item: UserUpcomingEventListItem) => void;
  onUpdated?: (event: ThreadEventItem) => void;
  onDeleted?: (deletedEventId: string) => void;
  onMembersAdded?: () => void;
};

export default function EventEditorModal({
  isPresented,
  isClosing,
  isActive,
  onClose,
  mode,
  currentUserId,
  event,
  canInvite = false,
  existingMemberUserIds = [],
  onCreated,
  onUpdated,
  onDeleted,
  onMembersAdded,
}: EventEditorModalProps) {
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [startsDraft, setStartsDraft] = useState(() => defaultCreateEventSchedule().startsAt);
  const [endsDraft, setEndsDraft] = useState(() => defaultCreateEventSchedule().endsAt);
  const [scheduleMode, setScheduleMode] = useState<EventScheduleMode>("single_day");
  const [blindReveal, setBlindReveal] = useState(false);
  const [closeDraft, setCloseDraft] = useState("");
  const [releaseDraft, setReleaseDraft] = useState("");
  const [selectedInvitees, setSelectedInvitees] = useState<UserSearchOption[]>([]);
  const [inviteSearchQuery, setInviteSearchQuery] = useState("");
  const [background, setBackground] = useState<BackgroundSelection | null>(null);
  const [defaultBackgrounds, setDefaultBackgrounds] = useState<DefaultBackgroundOption[]>([]);
  const [defaultBackgroundsLoading, setDefaultBackgroundsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [error, setError] = useState("");
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const backgroundInputRef = useRef<HTMLInputElement | null>(null);
  const initKeyRef = useRef<string | null>(null);

  const existingMemberIdSet = useMemo(
    () => new Set(existingMemberUserIds),
    [existingMemberUserIds],
  );

  const showInviteSection = mode === "create" || canInvite;
  const busy = isSaving || isDeleting;

  useEffect(() => {
    if (!isPresented) {
      initKeyRef.current = null;
      return;
    }

    const initKey = mode === "edit" && event ? `edit:${event.id}` : "create";
    if (initKeyRef.current === initKey) {
      return;
    }
    initKeyRef.current = initKey;

    if (mode === "edit" && event) {
      const startsAt = isoToEventLocalDatetime(event.starts_at);
      const endsAt = isoToEventLocalDatetime(event.ends_at);
      setName(event.name);
      setLocation(event.location ?? "");
      setDescription(event.description ?? "");
      setStartsDraft(startsAt);
      setEndsDraft(endsAt);
      setScheduleMode(scheduleModeForRange(startsAt, endsAt));
      setBlindReveal(event.blind_reveal);
      setCloseDraft(
        event.close_at
          ? isoToEventLocalDatetime(event.close_at)
          : localDatetimeInDays(DEFAULT_CLOSE_AFTER_DAYS),
      );
      setReleaseDraft(
        event.release_at
          ? isoToEventLocalDatetime(event.release_at)
          : localDatetimeInDays(DEFAULT_RELEASE_AFTER_DAYS),
      );
      setBackground(null);
    } else {
      const defaults = defaultCreateEventSchedule();
      setName("");
      setLocation("");
      setDescription("");
      setStartsDraft(defaults.startsAt);
      setEndsDraft(defaults.endsAt);
      setScheduleMode(defaults.mode);
      setBlindReveal(false);
      setCloseDraft("");
      setReleaseDraft("");
      setBackground(null);
    }
    setSelectedInvitees([]);
    setInviteSearchQuery("");
    setDeleteConfirm(false);
    setError("");

    return () => {
      // Strict Mode re-runs effects; clear so create defaults re-apply.
      if (initKeyRef.current === initKey) {
        initKeyRef.current = null;
      }
    };
  }, [isPresented, mode, event]);

  useEffect(() => {
    if (!isPresented) {
      return;
    }
    let cancelled = false;
    setDefaultBackgroundsLoading(true);
    void fetch("/api/default-event-images")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await readErrorMessage(response));
        }
        return response.json() as Promise<{ images: DefaultBackgroundOption[] }>;
      })
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setDefaultBackgrounds(payload.images);
        if (mode === "create") {
          setBackground((previous) => {
            if (previous?.kind === "upload") {
              return previous;
            }
            if (
              previous?.kind === "default" &&
              payload.images.some((image) => image.key === previous.key)
            ) {
              return previous;
            }
            const first = payload.images[0];
            return first ? { kind: "default", key: first.key } : null;
          });
        }
      })
      .catch((e) => {
        if (cancelled) {
          return;
        }
        setDefaultBackgrounds([]);
        setError(e instanceof Error ? e.message : "Failed to load background images.");
      })
      .finally(() => {
        if (!cancelled) {
          setDefaultBackgroundsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isPresented, mode]);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    window.setTimeout(() => {
      nameInputRef.current?.focus();
    }, 0);
  }, [isActive]);

  const onToggleBlindReveal = (checked: boolean) => {
    setBlindReveal(checked);
    if (checked) {
      setCloseDraft((previous) => previous || localDatetimeInDays(DEFAULT_CLOSE_AFTER_DAYS));
      setReleaseDraft((previous) => previous || localDatetimeInDays(DEFAULT_RELEASE_AFTER_DAYS));
    }
  };

  const searchInvitees = useCallback(
    async (query: string): Promise<UserSearchOption[]> => {
      try {
        const response = await postWithAuth("/api/friend-search", {
          query: query.trim() || undefined,
        });
        if (!response.ok) {
          return [];
        }
        const payload = (await response.json()) as FriendSearchResponse;
        const selectedIds = new Set(selectedInvitees.map((member) => member.id));
        return payload.users
          .filter(
            (user) =>
              user.id !== currentUserId &&
              !selectedIds.has(user.id) &&
              !existingMemberIdSet.has(user.id) &&
              user.relation?.accepted === true,
          )
          .map((user) => ({
            id: user.id,
            username: user.username,
            email: user.email,
            hint: "Friends",
            friendshipStatus: "friends" as const,
          }));
      } catch {
        return [];
      }
    },
    [currentUserId, existingMemberIdSet, selectedInvitees],
  );

  const onSelectInvitee = (option: UserSearchOption) => {
    setSelectedInvitees((previous) => {
      if (previous.some((member) => member.id === option.id)) {
        return previous;
      }
      return [...previous, option];
    });
    setInviteSearchQuery("");
    if (error) {
      setError("");
    }
  };

  const onRemoveInvitee = (userId: string) => {
    setSelectedInvitees((previous) => previous.filter((member) => member.id !== userId));
  };

  const onNameChange = (eventChange: ChangeEvent<HTMLInputElement>) => {
    setName(eventChange.target.value);
    if (error) {
      setError("");
    }
  };

  const onSelectDefaultBackground = (key: string) => {
    setBackground({ kind: "default", key });
    if (error) {
      setError("");
    }
  };

  const onBackgroundFileChange = async (eventChange: ChangeEvent<HTMLInputElement>) => {
    const file = eventChange.target.files?.[0];
    eventChange.target.value = "";
    if (!file) {
      return;
    }
    try {
      const prepared = await prepareImageForUpload(file);
      setBackground({
        kind: "upload",
        base64Data: prepared.base64Data,
        mimeType: prepared.mimeType,
        previewUrl: prepared.previewDataUrl,
      });
      if (error) {
        setError("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that image.");
    }
  };

  const applyBackgroundChange = async (
    eventItem: ThreadEventItem,
    selection: BackgroundSelection,
  ): Promise<ThreadEventItem> => {
    const requestBody: ThreadEventBackgroundSetRequest = {
      thread_id: eventItem.thread_id,
      event_id: eventItem.id,
    };
    if (selection.kind === "default") {
      requestBody.default_background_key = selection.key;
    } else {
      requestBody.image_base64_data = selection.base64Data;
      requestBody.image_mime_type = selection.mimeType;
    }
    const response = await postWithAuth("/api/thread-event-background-set", requestBody);
    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }
    const payload = (await response.json()) as ThreadEventBackgroundSetResponse;
    return payload.event;
  };

  const addSelectedInvitees = async (eventItem: ThreadEventItem): Promise<boolean> => {
    if (selectedInvitees.length === 0) {
      return false;
    }
    for (const invitee of selectedInvitees) {
      const response = await postWithAuth("/api/thread-member-add", {
        thread_id: eventItem.thread_id,
        event_id: eventItem.id,
        identifier: invitee.username,
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }
    }
    return true;
  };

  const onSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || busy) {
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      if (mode === "create") {
        if (!background) {
          setError("Pick a background image for the event.");
          return;
        }
        const requestBody: EventCreateRequest = {
          name: trimmedName,
          location: location.trim() || undefined,
          description: description.trim() || undefined,
        };
        if (background.kind === "default") {
          requestBody.default_background_key = background.key;
        } else {
          requestBody.image_base64_data = background.base64Data;
          requestBody.image_mime_type = background.mimeType;
        }
        if (!startsDraft || !endsDraft) {
          setError("Pick a day and time for the event.");
          return;
        }
        const startsAt = eventLocalDatetimeToDate(startsDraft);
        const endsAt = eventLocalDatetimeToDate(endsDraft);
        if (!startsAt || !endsAt) {
          setError("Invalid start or end time.");
          return;
        }
        if (endsAt <= startsAt) {
          setError("End must be after start.");
          return;
        }
        requestBody.starts_at = startsAt.toISOString();
        requestBody.ends_at = endsAt.toISOString();
        if (blindReveal) {
          if (!closeDraft || !releaseDraft) {
            setError("Pick a close and release time for the surprise album.");
            return;
          }
          const closeAt = eventLocalDatetimeToDate(closeDraft);
          const releaseAt = eventLocalDatetimeToDate(releaseDraft);
          if (!closeAt || !releaseAt) {
            setError("Invalid close or release time.");
            return;
          }
          if (releaseAt <= closeAt) {
            setError("Release must be after close.");
            return;
          }
          requestBody.blind_reveal = true;
          requestBody.close_at = closeAt.toISOString();
          requestBody.release_at = releaseAt.toISOString();
        }
        if (selectedInvitees.length > 0) {
          requestBody.invitee_user_ids = selectedInvitees.map((member) => member.id);
        }

        const response = await postWithAuth("/api/event-create", requestBody);
        if (!response.ok) {
          setError(await readErrorMessage(response));
          return;
        }
        const payload = (await response.json()) as EventCreateResponse;
        onCreated?.({ thread: payload.thread, event: payload.event });
        onClose();
        return;
      }

      if (!event) {
        setError("Missing event to edit.");
        return;
      }
      if (!startsDraft || !endsDraft) {
        setError("Set both a start and an end.");
        return;
      }
      const startsAt = eventLocalDatetimeToDate(startsDraft);
      const endsAt = eventLocalDatetimeToDate(endsDraft);
      if (!startsAt || !endsAt) {
        setError("Invalid start or end time.");
        return;
      }
      if (endsAt <= startsAt) {
        setError("End must be after start.");
        return;
      }

      const requestBody: ThreadEventUpdateRequest = {
        thread_id: event.thread_id,
        event_id: event.id,
        name: trimmedName,
        location: location.trim(),
        description: description.trim(),
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        blind_reveal: blindReveal,
      };
      if (blindReveal) {
        if (!closeDraft || !releaseDraft) {
          setError("Pick a close and release time for the surprise album.");
          return;
        }
        const closeAt = eventLocalDatetimeToDate(closeDraft);
        const releaseAt = eventLocalDatetimeToDate(releaseDraft);
        if (!closeAt || !releaseAt) {
          setError("Invalid close or release time.");
          return;
        }
        if (releaseAt <= closeAt) {
          setError("Release must be after close.");
          return;
        }
        requestBody.close_at = closeAt.toISOString();
        requestBody.release_at = releaseAt.toISOString();
      }

      const response = await postWithAuth("/api/thread-event-update", requestBody);
      if (!response.ok) {
        setError(await readErrorMessage(response));
        return;
      }
      let updatedEvent = ((await response.json()) as ThreadEventUpdateResponse).event;

      if (background) {
        updatedEvent = await applyBackgroundChange(updatedEvent, background);
      }

      const invited = canInvite ? await addSelectedInvitees(updatedEvent) : false;
      if (invited) {
        onMembersAdded?.();
      }

      onUpdated?.(updatedEvent);
      onClose();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : mode === "create"
            ? "Failed to create event."
            : "Failed to save event.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const onDelete = async () => {
    if (!event || busy) {
      return;
    }
    setIsDeleting(true);
    setError("");
    try {
      const response = await postWithAuth("/api/thread-event-delete", {
        thread_id: event.thread_id,
        event_id: event.id,
      });
      if (!response.ok) {
        setError(await readErrorMessage(response));
        setDeleteConfirm(false);
        return;
      }
      const payload = (await response.json()) as ThreadEventDeleteResponse;
      onDeleted?.(payload.deleted_event_id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete event.");
      setDeleteConfirm(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const title = mode === "create" ? "Create Event" : "Edit Event";
  const submitLabel = isSaving
    ? mode === "create"
      ? "Creating..."
      : "Saving..."
    : mode === "create"
      ? "Create"
      : "Save";

  return (
    <AnimatedModal
      isPresented={isPresented}
      isClosing={isClosing}
      onClose={onClose}
      ariaLabel={title}
      hideHeader
      closeDisabled={busy}
      panelClassName="h-[80dvh] max-w-md bg-bg shadow-xl"
    >
      <div className="relative flex h-full min-h-0 w-full flex-col bg-bg">
        <header className="flex shrink-0 items-center justify-between gap-3 px-4 pb-2 pt-3">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <div className="flex items-center gap-1">
            {mode === "edit" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (deleteConfirm) {
                    void onDelete();
                    return;
                  }
                  setDeleteConfirm(true);
                }}
                aria-label={deleteConfirm ? "Confirm delete event" : "Delete event"}
                className={`flex items-center gap-1.5 rounded-full px-2 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
                  deleteConfirm
                    ? "bg-danger/15 text-danger"
                    : "text-muted hover:text-foreground"
                }`}
              >
                <DeleteIcon className="h-5 w-5" />
                {deleteConfirm ? (isDeleting ? "Deleting…" : "Confirm Delete") : null}
              </button>
            ) : null}
            <IconButton
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={busy}
              aria-label="Close"
            >
              <CloseIcon className="h-5 w-5" />
            </IconButton>
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 pb-3">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted" htmlFor="event-editor-name">
              Name
            </label>
            <input
              ref={nameInputRef}
              id="event-editor-name"
              type="text"
              value={name}
              onChange={onNameChange}
              disabled={busy}
              placeholder="Event name"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-muted"
            />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted">Background</p>
            {background?.kind === "upload" ? (
              <div className="overflow-hidden rounded-xl border border-border">
                <img
                  src={background.previewUrl}
                  alt="Custom event background"
                  className="h-36 w-full object-cover"
                />
              </div>
            ) : mode === "edit" &&
              !background &&
              event?.background_image_id &&
              (event.background_image_url || event.background_image_access_grant) ? (
              <div className="overflow-hidden rounded-xl border border-border">
                <CachedImage
                  signedUrl={event.background_image_url}
                  imageAccessGrant={event.background_image_access_grant ?? null}
                  imageThreadId={event.thread_id}
                  imageId={event.background_image_id}
                  alt="Current event background"
                  className="h-36 w-full object-cover"
                />
              </div>
            ) : null}
            {defaultBackgroundsLoading ? (
              <p className="text-xs text-muted">Loading backgrounds…</p>
            ) : defaultBackgrounds.length === 0 ? (
              <p className="text-xs text-muted">No default backgrounds found.</p>
            ) : (
              <div className="overflow-x-auto overscroll-x-contain rounded-xl border border-border/60 p-2">
                <div className="grid w-max grid-flow-col grid-rows-2 auto-cols-[5rem] gap-2">
                  {defaultBackgrounds.map((option) => {
                    const selected =
                      background?.kind === "default" && background.key === option.key;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        disabled={busy}
                        onClick={() => onSelectDefaultBackground(option.key)}
                        aria-label={option.label}
                        aria-pressed={selected}
                        className={`h-20 w-20 overflow-hidden rounded-lg border-2 transition ${
                          selected
                            ? "border-accent ring-2 ring-accent shadow-[0_0_0_2px_color-mix(in_srgb,var(--accent)_55%,transparent)]"
                            : "border-transparent hover:border-muted"
                        }`}
                      >
                        <img
                          src={option.url}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <input
              ref={backgroundInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(eventChange) => {
                void onBackgroundFileChange(eventChange);
              }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => backgroundInputRef.current?.click()}
              className={`flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
                background?.kind === "upload"
                  ? "border-accent bg-accent/15 text-foreground"
                  : "border-border bg-surface text-foreground hover:border-muted"
              }`}
            >
              <AddImageIcon className="h-4 w-4" aria-hidden />
              {background?.kind === "upload" ? "Change uploaded image" : "Upload your own"}
            </button>
            {mode === "edit" && !background ? (
              <p className="text-[11px] text-muted">
                Current background stays unless you pick a new one.
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted" htmlFor="event-editor-location">
              Location
            </label>
            <input
              id="event-editor-location"
              type="text"
              value={location}
              onChange={(eventChange) => setLocation(eventChange.target.value)}
              disabled={busy}
              placeholder="Optional"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-muted"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted" htmlFor="event-editor-description">
              Details
            </label>
            <textarea
              id="event-editor-description"
              value={description}
              onChange={(eventChange) => setDescription(eventChange.target.value)}
              disabled={busy}
              rows={3}
              placeholder="Optional"
              className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-muted"
            />
          </div>

          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-xs font-medium text-muted">When</p>
            <EventScheduleFields
              mode={scheduleMode}
              onModeChange={setScheduleMode}
              startsAt={startsDraft}
              endsAt={endsDraft}
              onStartsAtChange={setStartsDraft}
              onEndsAtChange={setEndsDraft}
              disabled={busy}
            />
          </div>

          <div className="space-y-2 border-t border-border pt-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={blindReveal}
                disabled={busy}
                onChange={(eventChange) => onToggleBlindReveal(eventChange.target.checked)}
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
                  disabled={busy}
                />
                <EventDateTimeSelect
                  variant="inline"
                  label="Album released"
                  value={releaseDraft}
                  onChange={setReleaseDraft}
                  disabled={busy}
                />
              </div>
            ) : null}
          </div>

          {showInviteSection ? (
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-xs font-medium text-muted">
                {mode === "create" ? "Invite friends" : "Add people"}
              </p>
              {selectedInvitees.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {selectedInvitees.map((member) => (
                    <div
                      key={member.id}
                      className="flex items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1 pr-1.5"
                    >
                      <UserProfileImage
                        userId={member.id}
                        sizePx={24}
                        alt={`${member.username} profile`}
                      />
                      <span className="max-w-[8rem] truncate text-xs font-medium text-foreground">
                        {member.username}
                      </span>
                      <IconButton
                        type="button"
                        variant="ghost"
                        className="h-6 w-6 shrink-0"
                        disabled={busy}
                        aria-label={`Remove ${member.username}`}
                        onClick={() => onRemoveInvitee(member.id)}
                      >
                        <CloseIcon className="h-3.5 w-3.5" />
                      </IconButton>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="min-h-[50vh] h-[50vh]">
                <UserSearch
                  variant="panel"
                  value={inviteSearchQuery}
                  onValueChange={setInviteSearchQuery}
                  onSelect={onSelectInvitee}
                  searchUsers={searchInvitees}
                  placeholder="Search to add friends..."
                  disabled={busy}
                  noResultsText="No matching users."
                />
              </div>
            </div>
          ) : null}

          {error ? <p className="text-xs text-muted">{error}</p> : null}
        </div>

        <div className="shrink-0 border-t border-border px-4 py-3">
          <Button
            type="button"
            variant="primary"
            className="w-full"
            disabled={busy || !name.trim() || (mode === "create" && !background)}
            onClick={() => {
              void onSave();
            }}
          >
            {submitLabel}
          </Button>
        </div>
      </div>
    </AnimatedModal>
  );
}
