"use client";

import CachedImage from "@/app/components/utils/CachedImage";
import type { ThreadEventItem, ThreadEventRsvpStatus } from "@/app/types/interfaces";

type ThreadEventListRowProps = {
  event: ThreadEventItem;
  currentUserId: string;
  onOpen: () => void;
  /** e.g. group name + time — global upcoming list */
  metaLine?: string;
};

function countGoing(usersStatusMap: Record<string, ThreadEventRsvpStatus>): number {
  return Object.values(usersStatusMap).filter((s) => s === "going").length;
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
  const goingCount = countGoing(event.users_status_map);
  const youLabel = viewerRsvpLabel(currentUserId, event.users_status_map);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`relative w-full min-h-[3rem] overflow-hidden rounded-xl border border-accent-1/60 text-left shadow-sm shadow-black/20 touch-manipulation active:opacity-90 ${
        metaLine ? "h-[18vh] max-h-[18vh]" : "h-[15vh] max-h-[15vh]"
      }`}
    >
      {event.background_image_url ? (
        <CachedImage
          signedUrl={event.background_image_url}
          imageId={event.background_image_id}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover object-center"
        />
      ) : (
        <div
          className="absolute inset-0 bg-gradient-to-br from-accent-1 via-accent-1/80 to-secondary-background"
          aria-hidden
        />
      )}
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent"
        aria-hidden
      />
      <div className="absolute inset-x-0 bottom-0 z-10 px-3 pb-2.5 pt-10">
        <div className="rounded-xl border border-white/18 bg-primary-background/45 px-3 py-2 shadow-[0_8px_28px_rgba(0,0,0,0.5)] backdrop-blur-xl backdrop-saturate-150">
          <p className="truncate text-base font-semibold tracking-tight text-foreground [text-shadow:0_2px_10px_rgba(0,0,0,0.88)]">
            {event.name}
          </p>
          {metaLine ? (
            <p className="mt-0.5 truncate text-[11px] font-medium leading-snug text-foreground/80 [text-shadow:0_2px_8px_rgba(0,0,0,0.85)]">
              {metaLine}
            </p>
          ) : null}
          <p className="mt-1 truncate text-[11px] font-medium leading-snug text-foreground/90 [text-shadow:0_2px_8px_rgba(0,0,0,0.88)]">
            You: {youLabel}
            <span className="text-foreground/70"> · </span>
            {goingCount === 0
              ? "No one going yet"
              : goingCount === 1
                ? "1 person going"
                : `${goingCount} people going`}
          </p>
        </div>
      </div>
    </button>
  );
}
