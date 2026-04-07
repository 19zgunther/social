"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ImagePlus, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import BackButton from "@/app/components/utils/BackButton";
import CachedImage from "@/app/components/utils/CachedImage";
import EventDateTimeSelect, { isoToEventLocalDatetime } from "@/app/components/EventDateTimeSelect";
import UserProfileImage from "@/app/components/UserProfileImage";
import type {
  ApiError,
  ThreadEventBackgroundRemoveResponse,
  ThreadEventBackgroundSetResponse,
  ThreadEventItem,
  ThreadEventRsvpResponse,
  ThreadEventRsvpStatus,
  ThreadEventUpdateResponse,
  ThreadEventsListResponse,
  ThreadItem,
  ThreadMember,
  ThreadMembersResponse,
} from "@/app/types/interfaces";

type ThreadEventPageProps = {
  thread: ThreadItem;
  event: ThreadEventItem;
  currentUserId: string;
  onBack: () => void;
  onEventUpdated: (event: ThreadEventItem) => void;
  onEventDeleted: () => void;
  onNotify?: (message: string) => void;
};

const RSVP_OPTIONS: { status: ThreadEventRsvpStatus; label: string }[] = [
  { status: "going", label: "Going" },
  { status: "maybe", label: "Maybe" },
  { status: "not_going", label: "Not Going" },
];

function formatEventRange(startsAtIso: string, endsAtIso: string): string {
  try {
    const start = new Date(startsAtIso);
    const end = new Date(endsAtIso);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return "";
    }
    const opts: Intl.DateTimeFormatOptions = {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    };
    return `${start.toLocaleString(undefined, opts)} → ${end.toLocaleString(undefined, opts)}`;
  } catch {
    return "";
  }
}

const postJson = async (path: string, body: unknown): Promise<Response> => {
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

type ThreadEventPageCacheEntry = {
  fetchedAt: number;
  members: ThreadMember[];
  event: ThreadEventItem;
};

const threadEventPageCache = new Map<string, ThreadEventPageCacheEntry>();

function readFreshPageCache(eventId: string): ThreadEventPageCacheEntry | null {
  const row = threadEventPageCache.get(eventId);
  if (!row) {
    return null;
  }
  if (Date.now() - row.fetchedAt >= REFETCH_TTL_MS) {
    threadEventPageCache.delete(eventId);
    return null;
  }
  return row;
}

function writePageCache(eventId: string, members: ThreadMember[], event: ThreadEventItem) {
  threadEventPageCache.set(eventId, { fetchedAt: Date.now(), members, event });
}

/** Frosted panels over full-bleed event imagery */
const glassCard =
  "rounded-2xl border border-white/14 bg-secondary-background/50 shadow-[0_10px_44px_rgba(0,0,0,0.48),0_3px_16px_rgba(0,0,0,0.32)] backdrop-blur-[28px] backdrop-saturate-[1.4]";

const iconBtn =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/24 bg-primary-background/58 text-foreground shadow-[0_6px_22px_rgba(0,0,0,0.55),0_2px_8px_rgba(0,0,0,0.35)] backdrop-blur-xl transition hover:bg-primary-background/76 hover:shadow-[0_8px_28px_rgba(0,0,0,0.58)]";

const sectionLabel =
  "text-[11px] font-semibold uppercase tracking-wide text-foreground/92 [text-shadow:0_2px_10px_rgba(0,0,0,0.95),0_1px_3px_rgba(0,0,0,0.9)]";

const readableText =
  "text-sm text-foreground [text-shadow:0_2px_8px_rgba(0,0,0,0.92),0_1px_3px_rgba(0,0,0,0.88)]";

const titleDisplay =
  "text-xl font-bold leading-snug text-foreground [text-shadow:0_3px_18px_rgba(0,0,0,0.96),0_2px_6px_rgba(0,0,0,0.9)]";

const fieldGlass =
  "border-white/18 bg-primary-background/68 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_6px_24px_rgba(0,0,0,0.42)] backdrop-blur-xl";

const ghostActionBtn =
  "rounded-xl border border-white/20 bg-primary-background/52 py-2 text-xs font-semibold text-foreground shadow-[0_6px_22px_rgba(0,0,0,0.48)] backdrop-blur-xl [text-shadow:0_2px_8px_rgba(0,0,0,0.88)] transition hover:bg-primary-background/64";

const primaryActionBtn =
  "rounded-xl border border-white/25 bg-accent-3/92 py-2 text-xs font-semibold text-primary-background shadow-[0_8px_28px_rgba(10,132,255,0.5),0_4px_16px_rgba(0,0,0,0.4)] backdrop-blur-xl [text-shadow:0_1px_3px_rgba(0,0,0,0.45)] transition hover:bg-accent-3";

/** Frosted RSVP chips — white type, strong blur; selected state gets a colored glow per status */
const rsvpBtnBase =
  "flex-1 rounded-2xl border px-2 py-2.5 text-[11px] font-bold uppercase tracking-[0.08em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_8px_32px_rgba(0,0,0,0.42)] backdrop-blur-xl backdrop-saturate-[1.8] transition duration-200 disabled:opacity-50 [text-shadow:0_1px_2px_rgba(0,0,0,0.65)]";

const rsvpBtnIdle =
  "border-white/28 bg-white/[0.14] hover:border-white/40 hover:bg-white/[0.22] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_12px_40px_rgba(0,0,0,0.48)] active:scale-[0.98]";

const rsvpBtnSelected: Record<ThreadEventRsvpStatus, string> = {
  going:
    "border-emerald-200/55 bg-gradient-to-b from-emerald-400/45 via-emerald-500/35 to-emerald-900/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_0_36px_rgba(52,211,153,0.55),0_10px_36px_rgba(0,0,0,0.5)] ring-1 ring-emerald-200/35",
  maybe:
    "border-amber-200/50 bg-gradient-to-b from-amber-400/42 via-amber-500/32 to-amber-950/38 shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_0_32px_rgba(251,191,36,0.45),0_10px_36px_rgba(0,0,0,0.48)] ring-1 ring-amber-200/30",
  not_going:
    "border-rose-200/45 bg-gradient-to-b from-rose-400/38 via-rose-600/28 to-rose-950/42 shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_0_28px_rgba(251,113,133,0.4),0_10px_36px_rgba(0,0,0,0.5)] ring-1 ring-rose-200/25",
};

type RosterEntry = {
  userId: string;
  username: string;
  profile_image_url: string | null;
  profile_image_id: string | null;
};

function rosterEntriesForStatus(
  statusMap: Record<string, ThreadEventRsvpStatus>,
  status: ThreadEventRsvpStatus,
  memberById: Map<string, ThreadMember>,
): RosterEntry[] {
  const userIds = Object.entries(statusMap)
    .filter(([, s]) => s === status)
    .map(([id]) => id);
  return userIds
    .map((userId) => {
      const m = memberById.get(userId);
      return {
        userId,
        username: m?.username ?? "Unknown member",
        profile_image_url: m?.profile_image_url ?? null,
        profile_image_id: m?.profile_image_id ?? null,
      };
    })
    .sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: "base" }));
}

export default function ThreadEventPage({
  thread,
  event: eventProp,
  currentUserId,
  onBack,
  onEventUpdated,
  onEventDeleted,
  onNotify,
}: ThreadEventPageProps) {
  const [local, setLocal] = useState(eventProp);
  useEffect(() => {
    setLocal(eventProp);
  }, [eventProp]);

  const canEdit =
    currentUserId === local.created_by || currentUserId === thread.owner_user_id;
  const canDelete = canEdit;

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [editingLocation, setEditingLocation] = useState(false);
  const [locationDraft, setLocationDraft] = useState("");
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [startsDraft, setStartsDraft] = useState("");
  const [endsDraft, setEndsDraft] = useState("");
  const [fieldBusy, setFieldBusy] = useState(false);
  const [rsvpBusy, setRsvpBusy] = useState(false);
  const [bgBusy, setBgBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    setDeleteConfirm(false);
  }, [eventProp.id]);

  const [members, setMembers] = useState<ThreadMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [pageRefreshBusy, setPageRefreshBusy] = useState(false);
  const bgInputRef = useRef<HTMLInputElement | null>(null);
  const membersRef = useRef<ThreadMember[]>([]);
  const localRef = useRef<ThreadEventItem>(eventProp);
  const onEventUpdatedRef = useRef(onEventUpdated);
  const onNotifyRef = useRef(onNotify);

  useEffect(() => {
    membersRef.current = members;
  }, [members]);

  useEffect(() => {
    localRef.current = local;
  }, [local]);

  useEffect(() => {
    onEventUpdatedRef.current = onEventUpdated;
  }, [onEventUpdated]);

  useEffect(() => {
    onNotifyRef.current = onNotify;
  }, [onNotify]);

  const myStatus = local.users_status_map[currentUserId];

  const fetchEventPageData = useCallback(
    async (force: boolean) => {
      const eventId = eventProp.id;
      const threadId = thread.id;

      if (!force) {
        const cached = readFreshPageCache(eventId);
        if (cached) {
          setMembers(cached.members);
          setLocal(cached.event);
          onEventUpdatedRef.current(cached.event);
          setMembersLoading(false);
          return;
        }
      }

      setPageRefreshBusy(true);
      if (membersRef.current.length === 0) {
        setMembersLoading(true);
      }
      try {
        const [membersRes, eventsRes] = await Promise.all([
          postJson("/api/thread-members", { thread_id: threadId }),
          postJson("/api/thread-events-list", { thread_id: threadId }),
        ]);

        let nextMembers: ThreadMember[] = [];
        if (membersRes.ok) {
          const mPayload = (await membersRes.json()) as ThreadMembersResponse;
          nextMembers = mPayload.members;
        } else {
          nextMembers = [];
        }

        let nextEvent: ThreadEventItem = localRef.current;
        if (eventsRes.ok) {
          const ePayload = (await eventsRes.json()) as ThreadEventsListResponse;
          const found = ePayload.events.find((e) => e.id === eventId);
          if (found) {
            nextEvent = found;
          }
        }

        setMembers(nextMembers);
        setLocal(nextEvent);
        onEventUpdatedRef.current(nextEvent);
        writePageCache(eventId, nextMembers, nextEvent);
      } catch {
        setMembers([]);
        onNotifyRef.current?.("Couldn't refresh this event.");
      } finally {
        setPageRefreshBusy(false);
        setMembersLoading(false);
      }
    },
    [eventProp.id, thread.id],
  );

  useEffect(() => {
    void fetchEventPageData(false);
  }, [eventProp.id, thread.id, fetchEventPageData]);

  const memberById = useMemo(() => new Map(members.map((m) => [m.user_id, m])), [members]);

  const goingEntries = useMemo(
    () => rosterEntriesForStatus(local.users_status_map, "going", memberById),
    [local.users_status_map, memberById],
  );

  const commitmentIssuesEntries = useMemo(
    () => rosterEntriesForStatus(local.users_status_map, "maybe", memberById),
    [local.users_status_map, memberById],
  );

  const lameEntries = useMemo(
    () => rosterEntriesForStatus(local.users_status_map, "not_going", memberById),
    [local.users_status_map, memberById],
  );

  const patchEvent = async (fields: {
    name?: string;
    location?: string | null;
    description?: string | null;
    starts_at?: string;
    ends_at?: string;
  }) => {
    setFieldBusy(true);
    try {
      const response = await postJson("/api/thread-event-update", {
        thread_id: local.thread_id,
        event_id: local.id,
        name: fields.name ?? local.name,
        location: fields.location !== undefined ? fields.location : local.location,
        description: fields.description !== undefined ? fields.description : local.description,
        starts_at: fields.starts_at ?? local.starts_at,
        ends_at: fields.ends_at ?? local.ends_at,
      });
      if (!response.ok) {
        onNotify?.(await readErrorMessage(response));
        return;
      }
      const payload = (await response.json()) as ThreadEventUpdateResponse;
      setLocal(payload.event);
      onEventUpdated(payload.event);
      writePageCache(payload.event.id, membersRef.current, payload.event);
      onNotify?.("Saved.");
    } catch (e) {
      onNotify?.(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setFieldBusy(false);
    }
  };

  const onRsvp = async (status: ThreadEventRsvpStatus) => {
    setRsvpBusy(true);
    try {
      const response = await postJson("/api/thread-event-rsvp", {
        thread_id: local.thread_id,
        event_id: local.id,
        status,
      });
      if (!response.ok) {
        onNotify?.(await readErrorMessage(response));
        return;
      }
      const payload = (await response.json()) as ThreadEventRsvpResponse;
      setLocal(payload.event);
      onEventUpdated(payload.event);
      writePageCache(payload.event.id, membersRef.current, payload.event);
    } catch (e) {
      onNotify?.(e instanceof Error ? e.message : "RSVP failed.");
    } finally {
      setRsvpBusy(false);
    }
  };

  const onBackgroundFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file?.type.startsWith("image/")) {
      onNotify?.("Choose an image file.");
      return;
    }
    setBgBusy(true);
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = String(reader.result ?? "");
          const part = dataUrl.split(",")[1];
          if (!part) reject(new Error("Read failed"));
          else resolve(part);
        };
        reader.onerror = () => reject(new Error("Read failed"));
        reader.readAsDataURL(file);
      });
      const response = await postJson("/api/thread-event-background-set", {
        thread_id: local.thread_id,
        event_id: local.id,
        image_base64_data: base64Data,
        image_mime_type: file.type,
      });
      if (!response.ok) {
        onNotify?.(await readErrorMessage(response));
        return;
      }
      const payload = (await response.json()) as ThreadEventBackgroundSetResponse;
      setLocal(payload.event);
      onEventUpdated(payload.event);
      writePageCache(payload.event.id, membersRef.current, payload.event);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBgBusy(false);
    }
  };

  const removeBackground = async () => {
    if (!local.background_image_id) return;
    setBgBusy(true);
    try {
      const response = await postJson("/api/thread-event-background-remove", {
        thread_id: local.thread_id,
        event_id: local.id,
      });
      if (!response.ok) {
        onNotify?.(await readErrorMessage(response));
        return;
      }
      const payload = (await response.json()) as ThreadEventBackgroundRemoveResponse;
      setLocal(payload.event);
      onEventUpdated(payload.event);
      writePageCache(payload.event.id, membersRef.current, payload.event);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : "Remove failed.");
    } finally {
      setBgBusy(false);
    }
  };

  const performDelete = async () => {
    setIsDeleting(true);
    try {
      const response = await postJson("/api/thread-event-delete", {
        thread_id: local.thread_id,
        event_id: local.id,
      });
      if (!response.ok) {
        onNotify?.(await readErrorMessage(response));
        setDeleteConfirm(false);
        return;
      }
      await response.json();
      threadEventPageCache.delete(local.id);
      onEventDeleted();
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : "Delete failed.");
      setDeleteConfirm(false);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        {local.background_image_id &&
        (local.background_image_url || local.background_image_access_grant) ? (
          <CachedImage
            signedUrl={local.background_image_url}
            imageAccessGrant={local.background_image_access_grant ?? null}
            imageThreadId={local.thread_id}
            imageId={local.background_image_id}
            alt=""
            aria-hidden
            className="h-full min-h-full w-full object-cover object-center"
          />
        ) : (
          <div
            className="h-full min-h-full w-full bg-gradient-to-br from-accent-1/90 via-secondary-background to-primary-background"
            aria-hidden
          />
        )}
        <div
          className="absolute inset-0 bg-primary-background/58"
          aria-hidden
        />
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-white/14 bg-secondary-background/70 px-3 py-3 shadow-[0_8px_36px_rgba(0,0,0,0.48)] backdrop-blur-[28px] backdrop-saturate-150">
          <div className="flex min-w-0 items-center gap-1 justify-self-start">
            <BackButton onBack={onBack} backLabel="" textOnly />
          </div>
          <p className="min-w-0 truncate px-1 text-center text-sm font-semibold text-foreground [text-shadow:0_2px_12px_rgba(0,0,0,0.92),0_1px_4px_rgba(0,0,0,0.85)]">
            Event
          </p>
          <div className="flex min-w-[72px] shrink-0 justify-end justify-self-end gap-1">
            {canEdit ? (
              <>
                <input
                  ref={bgInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(ev) => {
                    void onBackgroundFile(ev);
                  }}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={bgBusy}
                  onClick={() => bgInputRef.current?.click()}
                  className={iconBtn}
                  aria-label="Add or change background image"
                >
                  <ImagePlus className="h-3.5 w-3.5" aria-hidden />
                </button>
                {local.background_image_id ? (
                  <button
                    type="button"
                    disabled={bgBusy}
                    onClick={() => {
                      void removeBackground();
                    }}
                    className={iconBtn}
                    aria-label="Remove background image"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y">
          <div className="space-y-4 px-3 py-4">
            <div className={`${glassCard} p-4`}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className={sectionLabel}>Name</p>
                {canEdit && !editingTitle ? (
                  <button
                    type="button"
                    className={iconBtn}
                    onClick={() => {
                      setTitleDraft(local.name);
                      setEditingTitle(true);
                    }}
                    aria-label="Edit name"
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </button>
                ) : null}
              </div>
              {editingTitle ? (
                <div className="flex items-start gap-2">
                  <input
                    type="text"
                    value={titleDraft}
                    onChange={(ev) => setTitleDraft(ev.target.value)}
                    disabled={fieldBusy}
                    className={`min-w-0 flex-1 rounded-xl border px-3 py-2 text-lg font-semibold text-foreground outline-none focus:border-accent-2 ${fieldGlass}`}
                    autoFocus
                  />
                  <button
                    type="button"
                    disabled={fieldBusy || !titleDraft.trim()}
                    className={iconBtn}
                    onClick={() => {
                      void patchEvent({ name: titleDraft.trim() });
                      setEditingTitle(false);
                    }}
                    aria-label="Save name"
                  >
                    <Check className="h-4 w-4 text-accent-3" aria-hidden />
                  </button>
                  <button
                    type="button"
                    disabled={fieldBusy}
                    className={iconBtn}
                    onClick={() => setEditingTitle(false)}
                    aria-label="Cancel"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              ) : (
                <h1 className={titleDisplay}>{local.name}</h1>
              )}

              <div className="mt-4 border-t border-white/10 pt-4">
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className={sectionLabel}>When</p>
              {canEdit && !editingSchedule ? (
                <button
                  type="button"
                  className={iconBtn}
                  onClick={() => {
                    setStartsDraft(isoToEventLocalDatetime(local.starts_at));
                    setEndsDraft(isoToEventLocalDatetime(local.ends_at));
                    setEditingSchedule(true);
                  }}
                  aria-label="Edit schedule"
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                </button>
              ) : null}
            </div>
            {editingSchedule ? (
              <div className="space-y-3">
                <EventDateTimeSelect
                  label="Starts"
                  value={startsDraft}
                  onChange={setStartsDraft}
                  disabled={fieldBusy}
                  className="shadow-[0_10px_40px_rgba(0,0,0,0.52)]"
                />
                <EventDateTimeSelect
                  label="Ends"
                  value={endsDraft}
                  onChange={setEndsDraft}
                  disabled={fieldBusy}
                  className="shadow-[0_10px_40px_rgba(0,0,0,0.52)]"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={fieldBusy}
                    className={`flex-1 ${ghostActionBtn}`}
                    onClick={() => setEditingSchedule(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={fieldBusy}
                    className={`flex-1 ${primaryActionBtn} disabled:opacity-50`}
                    onClick={() => {
                      if (!startsDraft || !endsDraft) {
                        onNotify?.("Pick start and end.");
                        return;
                      }
                      void patchEvent({
                        starts_at: new Date(startsDraft).toISOString(),
                        ends_at: new Date(endsDraft).toISOString(),
                      });
                      setEditingSchedule(false);
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <p className={readableText}>{formatEventRange(local.starts_at, local.ends_at)}</p>
            )}
              </div>

              <div className="mt-4 border-t border-white/10 pt-4">
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className={sectionLabel}>Where</p>
              {canEdit && !editingLocation ? (
                <button
                  type="button"
                  className={iconBtn}
                  onClick={() => {
                    setLocationDraft(local.location ?? "");
                    setEditingLocation(true);
                  }}
                  aria-label="Edit location"
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                </button>
              ) : null}
            </div>
            {editingLocation ? (
              <div className="flex items-start gap-2">
                <input
                  type="text"
                  value={locationDraft}
                  onChange={(ev) => setLocationDraft(ev.target.value)}
                  disabled={fieldBusy}
                  placeholder="Location"
                  className={`min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm text-foreground outline-none focus:border-accent-2 ${fieldGlass}`}
                  autoFocus
                />
                <button
                  type="button"
                  disabled={fieldBusy}
                  className={iconBtn}
                  onClick={() => {
                    void patchEvent({ location: locationDraft.trim() || null });
                    setEditingLocation(false);
                  }}
                  aria-label="Save location"
                >
                  <Check className="h-4 w-4 text-accent-3 drop-shadow-md" aria-hidden />
                </button>
                <button
                  type="button"
                  disabled={fieldBusy}
                  className={iconBtn}
                  onClick={() => setEditingLocation(false)}
                  aria-label="Cancel"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
            ) : (
              <p className={readableText}>{local.location ?? "—"}</p>
            )}
              </div>

              <div className="mt-4 border-t border-white/10 pt-4">
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className={sectionLabel}>Details</p>
              {canEdit && !editingDescription ? (
                <button
                  type="button"
                  className={iconBtn}
                  onClick={() => {
                    setDescriptionDraft(local.description ?? "");
                    setEditingDescription(true);
                  }}
                  aria-label="Edit description"
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                </button>
              ) : null}
            </div>
            {editingDescription ? (
              <div className="space-y-2">
                <textarea
                  value={descriptionDraft}
                  onChange={(ev) => setDescriptionDraft(ev.target.value)}
                  disabled={fieldBusy}
                  rows={4}
                  className={`w-full resize-none rounded-xl border px-3 py-2 text-sm text-foreground outline-none focus:border-accent-2 ${fieldGlass}`}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={fieldBusy}
                    className={`flex-1 ${ghostActionBtn}`}
                    onClick={() => setEditingDescription(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={fieldBusy}
                    className={`flex-1 ${primaryActionBtn} disabled:opacity-50`}
                    onClick={() => {
                      void patchEvent({ description: descriptionDraft.trim() || null });
                      setEditingDescription(false);
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <p className={`whitespace-pre-wrap ${readableText}`}>{local.description ?? "—"}</p>
            )}
              </div>
            </div>

            <div className={`${glassCard} p-4`}>
              <p className={`mb-2 ${sectionLabel}`}>Who's Going</p>
              {membersLoading ? (
                <p className={`text-sm opacity-75 ${readableText}`}>Loading…</p>
              ) : goingEntries.length === 0 ? (
                <p className={readableText}>Nobody's marked going yet.</p>
              ) : (
                <ul className="space-y-2">
                  {goingEntries.map((entry) => (
                    <li key={entry.userId} className="flex items-center gap-2.5">
                      <UserProfileImage
                        userId={entry.userId}
                        sizePx={36}
                        alt={entry.username}
                        signedUrl={entry.profile_image_url}
                        imageId={entry.profile_image_id}
                      />
                      <span className={`min-w-0 flex-1 truncate ${readableText}`}>{entry.username}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className={`${glassCard} p-4`}>
              <p className={`mb-2 ${sectionLabel}`}>Who hasn't decided yet</p>
              {membersLoading ? (
                <p className={`text-sm opacity-75 ${readableText}`}>Loading…</p>
              ) : commitmentIssuesEntries.length === 0 ? (
                <p className={readableText}>No maybes — everyone&apos;s picked a side.</p>
              ) : (
                <ul className="space-y-2">
                  {commitmentIssuesEntries.map((entry) => (
                    <li key={entry.userId} className="flex items-center gap-2.5">
                      <UserProfileImage
                        userId={entry.userId}
                        sizePx={36}
                        alt={entry.username}
                        signedUrl={entry.profile_image_url}
                        imageId={entry.profile_image_id}
                      />
                      <span className={`min-w-0 flex-1 truncate ${readableText}`}>{entry.username}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className={`${glassCard} p-4`}>
              <p className={`mb-2 ${sectionLabel}`}>Who's missing out</p>
              {membersLoading ? (
                <p className={`text-sm opacity-75 ${readableText}`}>Loading…</p>
              ) : lameEntries.length === 0 ? (
                <p className={readableText}>Nobody's bailed. Respect.</p>
              ) : (
                <ul className="space-y-2">
                  {lameEntries.map((entry) => (
                    <li key={entry.userId} className="flex items-center gap-2.5">
                      <UserProfileImage
                        userId={entry.userId}
                        sizePx={36}
                        alt={entry.username}
                        signedUrl={entry.profile_image_url}
                        imageId={entry.profile_image_id}
                      />
                      <span className={`min-w-0 flex-1 truncate ${readableText}`}>{entry.username}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className={`${glassCard} p-4`}>
            <p className={`mb-2 ${sectionLabel}`}>Your RSVP</p>
            <div className="flex gap-2">
              {RSVP_OPTIONS.map(({ status, label }) => {
                const isSelected = myStatus === status;
                const dim = myStatus !== undefined && !isSelected;
                return (
                  <button
                    key={status}
                    type="button"
                    disabled={rsvpBusy}
                    onClick={() => {
                      void onRsvp(status);
                    }}
                    className={`${rsvpBtnBase} ${
                      isSelected ? rsvpBtnSelected[status] : rsvpBtnIdle
                    } ${dim ? "opacity-[0.42]" : ""}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            </div>

          {canDelete ? (
            <div className={`${glassCard} p-4`}>
              {!deleteConfirm ? (
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => setDeleteConfirm(true)}
                  className="w-full rounded-xl border border-white/15 bg-primary-background/50 px-3 py-2.5 text-xs font-semibold text-foreground shadow-[0_6px_22px_rgba(0,0,0,0.45)] backdrop-blur-xl transition hover:bg-primary-background/60 disabled:opacity-50 [text-shadow:0_2px_8px_rgba(0,0,0,0.85)]"
                >
                  Delete event
                </button>
              ) : (
                <div className="space-y-3">
                  <p className={readableText}>
                    Delete this event for everyone? RSVPs and details will be removed. This can&apos;t be undone.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={isDeleting}
                      onClick={() => setDeleteConfirm(false)}
                      className={`flex-1 ${ghostActionBtn}`}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={isDeleting}
                      onClick={() => {
                        void performDelete();
                      }}
                      className="flex-1 rounded-xl border border-red-400/55 bg-red-950/40 py-2 text-xs font-semibold text-red-200 shadow-[0_6px_22px_rgba(0,0,0,0.45)] backdrop-blur-xl transition hover:bg-red-950/55 disabled:opacity-50 [text-shadow:0_1px_4px_rgba(0,0,0,0.75)]"
                    >
                      {isDeleting ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
        </div>
      </div>
    </div>
  );
}
