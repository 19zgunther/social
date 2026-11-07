import { createThreadBucketImageAccessGrant } from "@/app/api/image_access_grant";
import { prisma } from "@/app/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import {
  asEventSharedPostData,
  contributorHasUploaded,
  getEventAlbumPhase,
  isEventAlbumMediaVisible,
  stripSharedPostMediaForBlindView,
} from "@/app/lib/sharedPosts";
import type { PostData, ThreadEventItem, ThreadEventRsvpStatus } from "@/app/types/interfaces";

const RSVP_VALUES: ThreadEventRsvpStatus[] = ["going", "maybe", "not_going"];

export function isValidRsvpStatus(value: unknown): value is ThreadEventRsvpStatus {
  return typeof value === "string" && RSVP_VALUES.includes(value as ThreadEventRsvpStatus);
}

export function parseUsersStatusMap(raw: unknown): Record<string, ThreadEventRsvpStatus> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const out: Record<string, ThreadEventRsvpStatus> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isValidRsvpStatus(value)) {
      out[key] = value;
    }
  }
  return out;
}

export type ThreadEventRow = {
  id: string;
  created_at: Date;
  updated_at: Date;
  thread_id: string;
  created_by: string;
  name: string;
  location: string | null;
  description: string | null;
  users_status_map: Prisma.JsonValue;
  starts_at: Date;
  ends_at: Date;
  background_image_id: string | null;
  shared_post_data: Prisma.JsonValue | null;
  blind_reveal: boolean;
  close_at: Date | null;
  release_at: Date | null;
  published_post_id: string | null;
};

/**
 * Album payload for a viewer: media is stripped while a blind event is unreleased.
 * Album JSON is media-only (likes/comments live on the published post, not the event).
 */
export function serializeEventAlbumData(row: ThreadEventRow, _viewerUserId: string): PostData | null {
  if (row.shared_post_data === null || row.shared_post_data === undefined) {
    return null;
  }
  const dataObject = asEventSharedPostData(row.shared_post_data);
  if (!isEventAlbumMediaVisible(row)) {
    return stripSharedPostMediaForBlindView(dataObject);
  }
  const media = Array.isArray(dataObject.media) ? dataObject.media : undefined;
  return media && media.length > 0 ? { media } : {};
}

export function toThreadEventItem(row: ThreadEventRow, viewerUserId: string): ThreadEventItem {
  const album = asEventSharedPostData(row.shared_post_data);
  return {
    id: row.id,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    thread_id: row.thread_id,
    created_by: row.created_by,
    name: row.name,
    location: row.location,
    description: row.description,
    users_status_map: parseUsersStatusMap(row.users_status_map),
    starts_at: row.starts_at.toISOString(),
    ends_at: row.ends_at.toISOString(),
    background_image_id: row.background_image_id,
    background_image_url: null,
    blind_reveal: row.blind_reveal,
    close_at: row.close_at ? row.close_at.toISOString() : null,
    release_at: row.release_at ? row.release_at.toISOString() : null,
    shared_post_data: serializeEventAlbumData(row, viewerUserId),
    album_phase: getEventAlbumPhase(row),
    album_media_count: Array.isArray(album.media) ? album.media.length : 0,
    viewer_has_contributed: contributorHasUploaded(album, viewerUserId),
    published_post_id: row.published_post_id,
  };
}

export async function finalizeThreadEventItem(
  row: ThreadEventRow,
  viewerUserId: string,
): Promise<ThreadEventItem> {
  const base = toThreadEventItem(row, viewerUserId);
  if (!row.background_image_id) {
    return base;
  }
  try {
    const background_image_access_grant = createThreadBucketImageAccessGrant({
      threadId: row.thread_id,
      imageId: row.background_image_id,
      viewerUserId,
    });
    return { ...base, background_image_access_grant };
  } catch (error) {
    console.error("thread_event_background_grant_failed", row.id, error);
    return base;
  }
}

export async function findThreadAccessibleByUser(threadId: string, userId: string) {
  return prisma.threads.findFirst({
    where: {
      id: threadId,
      OR: [{ owner: userId }, { user_thread_access: { some: { user_id: userId } } }],
    },
    select: { id: true, owner: true },
  });
}

export function userCanAdminThreadEvent(input: {
  userId: string;
  threadOwnerId: string;
  eventCreatedBy: string;
}): boolean {
  return input.userId === input.eventCreatedBy || input.userId === input.threadOwnerId;
}

/** Event plus thread membership check; null when the event is missing or the viewer is not in its thread. */
export async function findThreadEventForMember(eventId: string, userId: string) {
  return prisma.thread_events.findFirst({
    where: {
      id: eventId,
      threads_thread_events_thread_idTothreads: {
        OR: [{ owner: userId }, { user_thread_access: { some: { user_id: userId } } }],
      },
    },
    include: {
      threads_thread_events_thread_idTothreads: {
        select: {
          owner: true,
          user_thread_access: { select: { user_id: true } },
        },
      },
    },
  });
}
