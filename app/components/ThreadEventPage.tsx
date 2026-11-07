"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import EventEditorModal from "@/app/components/EventEditorModal";
import { AddImageIcon, EditIcon } from "@/app/components/Icons";
import BackButton from "@/app/components/utils/BackButton";
import CachedImage from "@/app/components/utils/CachedImage";
import CachedVideo from "@/app/components/utils/CachedVideo";
import {
  prepareImageForUpload,
  prepareVideoForUpload,
  uploadPreparedImageToMainBucket,
  uploadPreparedVideoToMainBucket,
} from "@/app/components/utils/client_file_storage_utils";
import { useAnimatedModal } from "@/app/components/utils/AnimatedModal";
import {
  canContributeToEventAlbum,
  getEventAlbumPhase,
  isEventAlbumMediaVisible,
  MAX_SHARED_POST_MEDIA_PER_CONTRIBUTOR,
} from "@/app/lib/sharedPosts";
import UserProfileImage from "@/app/components/UserProfileImage";
import type {
  ApiError,
  EventContributeRequest,
  EventPublishPostResponse,
  PostMediaItem,
  ThreadEventItem,
  ThreadEventRsvpResponse,
  ThreadEventRsvpStatus,
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
  onOpenThread?: () => void;
  onEventUpdated: (event: ThreadEventItem) => void;
  onEventDeleted: (deletedEventId: string) => void;
  onNotify?: (message: string) => void;
};

const RSVP_OPTIONS: { status: ThreadEventRsvpStatus; label: string }[] = [
  { status: "going", label: "Going" },
  { status: "maybe", label: "Maybe" },
  { status: "not_going", label: "Not Going" },
];

function formatCompactEventTime(date: Date): string {
  const hour12 = date.getHours() % 12 || 12;
  const minutes = date.getMinutes();
  const suffix = date.getHours() < 12 ? "am" : "pm";
  return minutes === 0 ? `${hour12}${suffix}` : `${hour12}:${String(minutes).padStart(2, "0")}${suffix}`;
}

function formatEventRange(startsAtIso: string, endsAtIso: string): string {
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
    const sameDay = start.toDateString() === end.toDateString();
    const startT = formatCompactEventTime(start);
    const endT = formatCompactEventTime(end);
    if (sameDay) {
      return `${start.toLocaleString(undefined, dateOpts)} from ${startT} to ${endT}`;
    }
    return `${start.toLocaleString(undefined, dateOpts)} ${startT} → ${end.toLocaleString(undefined, dateOpts)} ${endT}`;
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

function formatAlbumInstant(iso: string | null): string {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

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
  "rounded-2xl border border-white/14 bg-surface/50 shadow-[0_10px_44px_rgba(0,0,0,0.48),0_3px_16px_rgba(0,0,0,0.32)] backdrop-blur-[28px] backdrop-saturate-[1.4]";

const iconBtn =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/24 bg-bg/58 text-foreground shadow-[0_6px_22px_rgba(0,0,0,0.55),0_2px_8px_rgba(0,0,0,0.35)] backdrop-blur-xl transition hover:bg-bg/76 hover:shadow-[0_8px_28px_rgba(0,0,0,0.58)]";

const readableText =
  "text-sm text-foreground [text-shadow:0_2px_8px_rgba(0,0,0,0.92),0_1px_3px_rgba(0,0,0,0.88)]";

const titleDisplay =
  "text-xl font-bold leading-snug text-foreground [text-shadow:0_3px_18px_rgba(0,0,0,0.96),0_2px_6px_rgba(0,0,0,0.9)]";

const primaryActionBtn =
  "rounded-xl border border-white/25 bg-accent/92 py-2 text-xs font-semibold text-on-accent shadow-[0_8px_28px_color-mix(in_srgb,var(--accent)_50%,transparent),0_4px_16px_rgba(0,0,0,0.4)] backdrop-blur-xl [text-shadow:0_1px_3px_rgba(0,0,0,0.45)] transition hover:bg-accent";

/** Frosted RSVP chips — white type, strong blur; selected state gets a colored glow per status */
const rsvpBtnBase =
  "flex-1 rounded-2xl border px-2 py-2.5 text-[11px] font-bold uppercase tracking-[0.08em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_8px_32px_rgba(0,0,0,0.42)] backdrop-blur-xl backdrop-saturate-[1.8] transition duration-200 disabled:opacity-50 [text-shadow:0_1px_2px_rgba(0,0,0,0.65)]";

const rsvpBtnIdle =
  "border-white/28 bg-white/[0.14] hover:border-white/40 hover:bg-white/[0.22] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_12px_40px_rgba(0,0,0,0.48)] active:scale-[0.98]";

const rsvpBtnSelected: Record<ThreadEventRsvpStatus, string> = {
  going:
    "border-success/55 bg-gradient-to-b from-success/45 via-success/35 to-success/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_0_36px_rgba(34,197,94,0.55),0_10px_36px_rgba(0,0,0,0.5)] ring-1 ring-success/35",
  maybe:
    "border-warning/50 bg-gradient-to-b from-warning/42 via-warning/32 to-warning/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_0_32px_rgba(245,158,11,0.45),0_10px_36px_rgba(0,0,0,0.48)] ring-1 ring-warning/30",
  not_going:
    "border-danger/45 bg-gradient-to-b from-danger/38 via-danger/28 to-danger/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_0_28px_rgba(248,113,113,0.4),0_10px_36px_rgba(0,0,0,0.5)] ring-1 ring-danger/25",
};

type RosterEntry = {
  userId: string;
  username: string;
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
      };
    })
    .sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: "base" }));
}

function undecidedRosterEntries(
  members: ThreadMember[],
  statusMap: Record<string, ThreadEventRsvpStatus>,
): RosterEntry[] {
  return members
    .filter((member) => {
      const status = statusMap[member.user_id];
      return status === undefined || status === "maybe";
    })
    .map((member) => ({
      userId: member.user_id,
      username: member.username,
    }))
    .sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: "base" }));
}

function EventPeopleList({
  title,
  entries,
  emptyText,
  loading,
}: {
  title: string;
  entries: RosterEntry[];
  emptyText: string;
  loading: boolean;
}) {
  return (
    <div className="space-y-2.5">
      <p className="text-sm font-semibold text-foreground [text-shadow:0_2px_10px_rgba(0,0,0,0.92)]">
        {title} ({entries.length})
      </p>
      {loading ? (
        <p className={`text-sm opacity-75 ${readableText}`}>Loading…</p>
      ) : entries.length === 0 ? (
        <p className={`text-sm opacity-80 ${readableText}`}>{emptyText}</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li key={entry.userId} className="flex items-center gap-3">
              <UserProfileImage userId={entry.userId} sizePx={40} alt={entry.username} />
              <span className={`min-w-0 flex-1 truncate text-sm font-medium ${readableText}`}>
                {entry.username}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ThreadEventPage({
  thread,
  event: eventProp,
  currentUserId,
  onBack,
  onOpenThread,
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
  const canInvite = currentUserId === thread.owner_user_id;

  const [rsvpBusy, setRsvpBusy] = useState(false);
  const [albumBusy, setAlbumBusy] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const [albumGrants, setAlbumGrants] = useState<Record<string, string | null>>({});
  const albumInputRef = useRef<HTMLInputElement | null>(null);
  const {
    isPresented: isEditPresented,
    isClosing: isEditClosing,
    isActive: isEditActive,
    open: openEditModal,
    close: closeEditModal,
  } = useAnimatedModal();

  const [members, setMembers] = useState<ThreadMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
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
        setMembersLoading(false);
      }
    },
    [eventProp.id, thread.id],
  );

  useEffect(() => {
    void fetchEventPageData(false);
  }, [eventProp.id, thread.id, fetchEventPageData]);

  const memberById = useMemo(() => new Map(members.map((m) => [m.user_id, m])), [members]);
  const existingMemberUserIds = useMemo(() => members.map((m) => m.user_id), [members]);

  const goingEntries = useMemo(
    () => rosterEntriesForStatus(local.users_status_map, "going", memberById),
    [local.users_status_map, memberById],
  );

  const undecidedEntries = useMemo(
    () => undecidedRosterEntries(members, local.users_status_map),
    [members, local.users_status_map],
  );

  const missingOutEntries = useMemo(
    () => rosterEntriesForStatus(local.users_status_map, "not_going", memberById),
    [local.users_status_map, memberById],
  );

  const onEventSavedFromModal = (updated: ThreadEventItem) => {
    setLocal(updated);
    onEventUpdated(updated);
    writePageCache(updated.id, membersRef.current, updated);
    onNotify?.("Saved.");
  };

  const onEventDeletedFromModal = (deletedEventId: string) => {
    threadEventPageCache.delete(deletedEventId);
    onEventDeleted(deletedEventId);
  };

  const onMembersAddedFromModal = () => {
    void fetchEventPageData(true);
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

  const albumTiming = useMemo(
    () => ({
      blind_reveal: local.blind_reveal,
      close_at: local.close_at ? new Date(local.close_at) : null,
      release_at: local.release_at ? new Date(local.release_at) : null,
    }),
    [local.blind_reveal, local.close_at, local.release_at],
  );
  const albumPhase = getEventAlbumPhase(albumTiming);
  const albumMediaVisible = isEventAlbumMediaVisible(albumTiming);
  const albumCanContribute = canContributeToEventAlbum(albumTiming);
  const albumMediaCount = local.album_media_count ?? 0;
  const albumCloseLabel = formatAlbumInstant(local.close_at);
  const albumReleaseLabel = formatAlbumInstant(local.release_at);
  const albumStatusText = !local.blind_reveal
    ? "Everyone in this event can add photos and videos."
    : albumPhase === "open"
      ? `Surprise album — uploads close ${albumCloseLabel}. Photos are revealed ${albumReleaseLabel}.`
      : albumPhase === "released"
        ? `Surprise album — revealed ${albumReleaseLabel}.`
        : albumCloseLabel && albumReleaseLabel
          ? `Surprise album — uploads closed. Photos are revealed ${albumReleaseLabel}.`
          : "Surprise album — dates aren't set yet.";

  const albumMedia = useMemo<PostMediaItem[]>(
    () => (albumMediaVisible ? (local.shared_post_data?.media ?? []) : []),
    [albumMediaVisible, local.shared_post_data],
  );

  const albumObjectIdsKey = useMemo(
    () =>
      albumMedia
        .flatMap((item) => (item.kind === "video" && item.poster_id ? [item.id, item.poster_id] : [item.id]))
        .join(","),
    [albumMedia],
  );

  useEffect(() => {
    if (!albumObjectIdsKey) {
      return;
    }
    let cancelled = false;
    const loadGrants = async () => {
      try {
        const response = await postJson("/api/image-access-grants", {
          event_id: local.id,
          image_ids: albumObjectIdsKey.split(","),
        });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as { grants_by_id?: Record<string, string | null> };
        if (!cancelled) {
          setAlbumGrants((previous) => ({ ...previous, ...payload.grants_by_id }));
        }
      } catch {
        // Thumbnails simply stay as placeholders.
      }
    };
    void loadGrants();
    return () => {
      cancelled = true;
    };
  }, [albumObjectIdsKey, local.id]);

  const onAlbumFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) {
      return;
    }
    if (files.length > MAX_SHARED_POST_MEDIA_PER_CONTRIBUTOR) {
      onNotify?.(`Choose up to ${MAX_SHARED_POST_MEDIA_PER_CONTRIBUTOR} photos or videos at a time.`);
      return;
    }
    setAlbumBusy(true);
    try {
      const uploaded: PostMediaItem[] = [];
      for (const file of files) {
        if (file.type.startsWith("image/")) {
          const preparedImage = await prepareImageForUpload(file);
          const imageUpload = await uploadPreparedImageToMainBucket(preparedImage, postJson);
          if (!imageUpload.image_id) {
            throw new Error("Image upload failed.");
          }
          uploaded.push({ id: imageUpload.image_id, kind: "image", owner_user_id: currentUserId });
          continue;
        }
        const preparedVideo = await prepareVideoForUpload(file);
        const videoUpload = await uploadPreparedVideoToMainBucket(preparedVideo, postJson);
        uploaded.push({
          id: videoUpload.video_id,
          kind: "video",
          poster_id: videoUpload.poster_id,
          owner_user_id: currentUserId,
        });
      }
      const requestBody: EventContributeRequest = { event_id: local.id, media: uploaded };
      const response = await postJson("/api/event-contribute", requestBody);
      if (!response.ok) {
        onNotify?.(await readErrorMessage(response));
        return;
      }
      onNotify?.("Added to the album.");
      await fetchEventPageData(true);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setAlbumBusy(false);
    }
  };

  const canPublishAlbum = currentUserId === local.created_by;

  const onPublishAlbumAsPost = async () => {
    if (!canPublishAlbum || publishBusy || local.published_post_id) {
      return;
    }
    setPublishBusy(true);
    try {
      const response = await postJson("/api/event-publish-post", { event_id: local.id });
      if (!response.ok) {
        onNotify?.(await readErrorMessage(response));
        return;
      }
      const payload = (await response.json()) as EventPublishPostResponse;
      setLocal(payload.event);
      onEventUpdated(payload.event);
      writePageCache(payload.event.id, members, payload.event);
      onNotify?.("Published to the feed.");
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : "Failed to publish.");
    } finally {
      setPublishBusy(false);
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
            className="h-full min-h-full w-full bg-gradient-to-br from-border/90 via-surface to-bg"
            aria-hidden
          />
        )}
        <div
          className="absolute inset-0 bg-bg/58"
          aria-hidden
        />
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-white/14 bg-surface/70 px-3 py-3 shadow-[0_8px_36px_rgba(0,0,0,0.48)] backdrop-blur-[28px] backdrop-saturate-150">
          <div className="flex min-w-0 items-center gap-1 justify-self-start">
            <BackButton onBack={onBack} />
          </div>
          <p className="min-w-0 truncate px-1 text-center text-sm font-semibold text-foreground [text-shadow:0_2px_12px_rgba(0,0,0,0.92),0_1px_4px_rgba(0,0,0,0.85)]">
            Event
          </p>
          <div className="flex min-w-[72px] shrink-0 justify-end justify-self-end gap-1">
            {onOpenThread ? (
              <button
                type="button"
                onClick={onOpenThread}
                className="rounded-lg border border-white/24 bg-bg/58 px-2 py-1 text-[11px] font-semibold text-foreground shadow-[0_6px_22px_rgba(0,0,0,0.55),0_2px_8px_rgba(0,0,0,0.35)] backdrop-blur-xl transition hover:bg-bg/76"
              >
                Open Thread
              </button>
            ) : null}
            {canEdit ? (
              <button
                type="button"
                onClick={openEditModal}
                className={iconBtn}
                aria-label="Edit event"
              >
                <EditIcon className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : null}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y">
          <div className="space-y-4 px-3 py-4">
            <div className={`${glassCard} relative z-20 space-y-2 p-4`}>
              <h1 className={titleDisplay}>{local.name}</h1>
              <p className={`opacity-90 ${readableText}`}>
                {formatEventRange(local.starts_at, local.ends_at)}
              </p>
              {local.location ? (
                <p className={`opacity-90 ${readableText}`}>{local.location}</p>
              ) : null}
              {local.description ? (
                <p className={`whitespace-pre-wrap pt-1 opacity-95 ${readableText}`}>
                  {local.description}
                </p>
              ) : null}
            </div>

            <div className={`${glassCard} relative z-0 p-4`}>
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

            <div className={`${glassCard} relative z-0 space-y-5 p-4`}>
              <EventPeopleList
                title="Who's Going"
                entries={goingEntries}
                emptyText="Nobody's marked going yet."
                loading={membersLoading}
              />
              <EventPeopleList
                title="Who Hasn't Decided"
                entries={undecidedEntries}
                emptyText="Everyone's picked a side."
                loading={membersLoading}
              />
              <EventPeopleList
                title="Who's Missing Out"
                entries={missingOutEntries}
                emptyText="Nobody's sitting this one out."
                loading={membersLoading}
              />
            </div>

            <div className={`${glassCard} relative z-0 p-4`}>
              <p className="mb-2 text-sm font-semibold text-foreground [text-shadow:0_2px_10px_rgba(0,0,0,0.92)]">
                Photos and videos
              </p>
              <div className="space-y-3">
                <p className={`text-xs opacity-80 ${readableText}`}>
                  {albumStatusText}
                  {" · "}
                  {albumMediaCount === 1
                    ? "1 photo or video"
                    : `${albumMediaCount} photos and videos`}
                  {" · "}
                  {local.viewer_has_contributed
                    ? "You've contributed"
                    : "You haven't contributed yet"}
                </p>

                {albumCanContribute ? (
                  <>
                    <input
                      ref={albumInputRef}
                      type="file"
                      accept="image/*,video/*"
                      multiple
                      onChange={(ev) => {
                        void onAlbumFiles(ev);
                      }}
                      className="hidden"
                    />
                    <button
                      type="button"
                      disabled={albumBusy}
                      onClick={() => albumInputRef.current?.click()}
                      className={`flex w-full items-center justify-center gap-2 px-3 ${primaryActionBtn} disabled:opacity-50`}
                    >
                      <AddImageIcon className="h-4 w-4" aria-hidden />
                      {albumBusy
                        ? "Uploading…"
                        : `Add photos or videos (up to ${MAX_SHARED_POST_MEDIA_PER_CONTRIBUTOR} each)`}
                    </button>
                  </>
                ) : null}

                {!albumMediaVisible ? (
                  <p className={readableText}>Photos hidden until release.</p>
                ) : albumMedia.length === 0 ? (
                  <p className={readableText}>No photos yet.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-1.5">
                    {albumMedia.map((item) => {
                      const grant = albumGrants[item.id] ?? null;
                      const posterGrant = item.poster_id
                        ? (albumGrants[item.poster_id] ?? null)
                        : null;
                      return (
                        <div
                          key={item.id}
                          className="aspect-square overflow-hidden rounded-lg border border-white/12 bg-bg/60"
                        >
                          {item.kind === "video" ? (
                            grant || posterGrant ? (
                              <CachedVideo
                                mediaId={item.id}
                                mediaAccessGrant={grant}
                                mediaStorageUserId={item.owner_user_id ?? null}
                                posterId={item.poster_id ?? null}
                                posterAccessGrant={posterGrant}
                                isActive
                                className="h-full w-full object-cover"
                              />
                            ) : null
                          ) : grant ? (
                            <CachedImage
                              imageId={item.id}
                              imageAccessGrant={grant}
                              imageStorageUserId={item.owner_user_id ?? null}
                              alt="Event album"
                              className="h-full w-full object-cover"
                            />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}

                {canPublishAlbum && albumMediaVisible && albumMediaCount > 0 ? (
                  local.published_post_id ? (
                    <p className={`text-xs opacity-80 ${readableText}`}>
                      Album published to the feed.
                    </p>
                  ) : (
                    <button
                      type="button"
                      disabled={publishBusy}
                      onClick={() => {
                        void onPublishAlbumAsPost();
                      }}
                      className={`flex w-full items-center justify-center gap-2 px-3 ${primaryActionBtn} disabled:opacity-50`}
                    >
                      {publishBusy ? "Publishing…" : "Publish album as post"}
                    </button>
                  )
                ) : null}
              </div>
            </div>

          </div>
        </div>
      </div>

      <EventEditorModal
        isPresented={isEditPresented}
        isClosing={isEditClosing}
        isActive={isEditActive}
        onClose={closeEditModal}
        mode="edit"
        currentUserId={currentUserId}
        event={local}
        canInvite={canInvite}
        existingMemberUserIds={existingMemberUserIds}
        onUpdated={onEventSavedFromModal}
        onDeleted={onEventDeletedFromModal}
        onMembersAdded={onMembersAddedFromModal}
      />
    </div>
  );
}
