"use client";

import { useMemo } from "react";
import UserProfileImage from "@/app/components/UserProfileImage";
import CachedImage from "@/app/components/utils/CachedImage";
import type { ThreadEventItem, ThreadEventRsvpStatus } from "@/app/types/interfaces";

type ThreadEventListRowProps = {
  event: ThreadEventItem;
  currentUserId: string;
  onOpen: () => void;
  /** e.g. group name + time — global upcoming list */
  metaLine?: string;
};

const MAX_VISIBLE_GOING_AVATARS = 5;
const GOING_AVATAR_SIZE_PX = 26;

function goingUserIds(
  usersStatusMap: Record<string, ThreadEventRsvpStatus>,
  currentUserId: string,
): string[] {
  const ids = Object.entries(usersStatusMap)
    .filter(([, status]) => status === "going")
    .map(([userId]) => userId);
  ids.sort((a, b) => {
    if (a === currentUserId) return -1;
    if (b === currentUserId) return 1;
    return a.localeCompare(b);
  });
  return ids;
}

function viewerRsvpLabel(
  userId: string,
  usersStatusMap: Record<string, ThreadEventRsvpStatus>,
): string {
  const status = usersStatusMap[userId];
  if (status === undefined) {
    return "Haven't decided";
  }
  if (status === "going") {
    return "Going";
  }
  if (status === "maybe") {
    return "Maybe";
  }
  return "Not going";
}

export default function ThreadEventListRow({
  event,
  currentUserId,
  onOpen,
  metaLine,
}: ThreadEventListRowProps) {
  const goingIds = useMemo(
    () => goingUserIds(event.users_status_map, currentUserId),
    [event.users_status_map, currentUserId],
  );
  const goingCount = goingIds.length;
  const visibleGoingIds = goingIds.slice(0, MAX_VISIBLE_GOING_AVATARS);
  const overflowGoing = goingCount - visibleGoingIds.length;
  const youLabel = viewerRsvpLabel(currentUserId, event.users_status_map);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative aspect-[5/4] w-full min-h-[3rem] overflow-hidden rounded-xl border border-border/60 text-left shadow-sm shadow-black/20 touch-manipulation active:opacity-90"
    >
      {event.background_image_id &&
      (event.background_image_url || event.background_image_access_grant) ? (
        <CachedImage
          signedUrl={event.background_image_url}
          imageAccessGrant={event.background_image_access_grant ?? null}
          imageThreadId={event.thread_id}
          imageId={event.background_image_id}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover object-center"
        />
      ) : (
        <div
          className="absolute inset-0 bg-gradient-to-br from-border via-border/80 to-surface"
          aria-hidden
        />
      )}
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent"
        aria-hidden
      />
      <div className="absolute inset-x-0 bottom-0 z-10 px-3 pb-2.5 pt-10">
        <div className="rounded-xl border border-white/18 bg-bg/45 px-3 py-2 shadow-[0_8px_28px_rgba(0,0,0,0.5)] backdrop-blur-xl backdrop-saturate-150">
          <p className="truncate text-base font-semibold tracking-tight text-foreground [text-shadow:0_2px_10px_rgba(0,0,0,0.88)]">
            {event.name}
          </p>
          {metaLine ? (
            <p className="mt-0.5 truncate text-[11px] font-medium leading-snug text-foreground/80 [text-shadow:0_2px_8px_rgba(0,0,0,0.85)]">
              {metaLine}
            </p>
          ) : null}
          <div className="mt-1.5 flex min-w-0 items-center gap-2">
            {goingCount > 0 ? (
              <div className="flex shrink-0 items-center" aria-label={`${goingCount} going`}>
                {visibleGoingIds.map((userId, index) => (
                  <div
                    key={userId}
                    className="relative rounded-full ring-2 ring-black/55"
                    style={{
                      marginLeft: index === 0 ? 0 : -8,
                      zIndex: visibleGoingIds.length - index,
                    }}
                  >
                    <UserProfileImage
                      userId={userId}
                      sizePx={GOING_AVATAR_SIZE_PX}
                      alt="Going"
                      className="pointer-events-none"
                    />
                  </div>
                ))}
                {overflowGoing > 0 ? (
                  <div
                    className="relative flex items-center justify-center rounded-full bg-bg/85 text-[10px] font-semibold text-foreground ring-2 ring-black/55 [text-shadow:none]"
                    style={{
                      width: GOING_AVATAR_SIZE_PX,
                      height: GOING_AVATAR_SIZE_PX,
                      marginLeft: -8,
                      zIndex: 0,
                    }}
                  >
                    +{overflowGoing}
                  </div>
                ) : null}
              </div>
            ) : null}
            <p className="min-w-0 truncate text-[11px] font-medium leading-snug text-foreground/90 [text-shadow:0_2px_8px_rgba(0,0,0,0.88)]">
              You: {youLabel}
              <span className="text-foreground/70"> · </span>
              {goingCount === 0
                ? "No one going yet"
                : goingCount === 1
                  ? "1 going"
                  : `${goingCount} going`}
            </p>
          </div>
        </div>
      </div>
    </button>
  );
}
