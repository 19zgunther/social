"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import CachedImage from "@/app/components/utils/CachedImage";
import UserProfileImage from "@/app/components/UserProfileImage";
import { resolveEmojisByUuid } from "@/app/lib/customEmojiCache";
import {
  CustomEmoji,
  customEmojiUuidFromToken,
} from "@/app/lib/customEmojiCanvas";
import { downloadImageBlobWithExtension, getImageBlob } from "@/app/lib/imageCache";
import { EmojiItem, PostCommentNode, PostItem } from "@/app/types/interfaces";

type PostOptionsPaneProps = {
  post: PostItem;
  onBack: () => void;
  onViewUserProfile?: (userId: string) => void;
};

const EMOJI_ONLY_COMMENT_REGEX = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\uFE0F|\u200D|\s)+$/u;
const HAS_EMOJI_REGEX = /\p{Extended_Pictographic}/u;

const isEmojiOnlyComment = (value: string): boolean => {
  const trimmed = value.trim();
  return (
    (Boolean(trimmed) && EMOJI_ONLY_COMMENT_REGEX.test(trimmed) && HAS_EMOJI_REGEX.test(trimmed))
    || customEmojiUuidFromToken(trimmed) !== null
  );
};

function RenderReactionEmoji({
  value,
  customEmojiByUuid,
  className,
}: {
  value: string;
  customEmojiByUuid: Record<string, EmojiItem>;
  className?: string;
}) {
  const uuid = customEmojiUuidFromToken(value);
  if (!uuid) {
    return <span className={className ?? "text-2xl leading-none"}>{value}</span>;
  }
  const customEmoji = customEmojiByUuid[uuid];
  if (!customEmoji) {
    return <span className={className ?? "text-2xl leading-none"}>?</span>;
  }
  return <CustomEmoji customEmoji={customEmoji} />;
}

const collectCustomEmojiUuids = (comments: Record<string, PostCommentNode> | undefined): string[] => {
  const uuids = new Set<string>();
  const walk = (nodes: Record<string, PostCommentNode> | undefined) => {
    if (!nodes) {
      return;
    }
    Object.values(nodes).forEach((comment) => {
      const uuid = customEmojiUuidFromToken(comment.text);
      if (uuid) {
        uuids.add(uuid);
      }
      walk(comment.replies);
    });
  };
  walk(comments);
  return Array.from(uuids);
};

const buildImageIds = (post: PostItem): string[] => {
  const ids: string[] = [];
  if (post.image_id) {
    ids.push(post.image_id);
  }
  for (const imageId of post.data?.other_image_ids ?? []) {
    if (!imageId || ids.includes(imageId)) {
      continue;
    }
    ids.push(imageId);
  }
  return ids;
};

export default function PostOptionsPane({
  post,
  onBack,
  onViewUserProfile,
}: PostOptionsPaneProps) {
  const [customEmojiByUuid, setCustomEmojiByUuid] = useState<Record<string, EmojiItem>>({});
  const [imageGrantById, setImageGrantById] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    if (post.image_id && post.image_access_grant) {
      initial[post.image_id] = post.image_access_grant;
    }
    return initial;
  });
  const [isLoadingImageGrants, setIsLoadingImageGrants] = useState(false);
  const [downloadingImageId, setDownloadingImageId] = useState<string | null>(null);
  const [downloadStatusMessage, setDownloadStatusMessage] = useState("");

  const comments = post.data?.comments;
  const imageIds = useMemo(() => buildImageIds(post), [post]);

  const customEmojiUuids = useMemo(() => collectCustomEmojiUuids(comments), [comments]);

  useEffect(() => {
    setImageGrantById(() => {
      const next: Record<string, string> = {};
      if (post.image_id && post.image_access_grant) {
        next[post.image_id] = post.image_access_grant;
      }
      return next;
    });
    setDownloadStatusMessage("");
    setDownloadingImageId(null);
  }, [post.id, post.image_id, post.image_access_grant]);

  useEffect(() => {
    const missingImageIds = imageIds.filter((imageId) => {
      if (imageId === post.image_id && post.image_access_grant) {
        return false;
      }
      return true;
    });
    if (missingImageIds.length === 0) {
      return;
    }

    let cancelled = false;
    const loadImageGrants = async () => {
      setIsLoadingImageGrants(true);
      try {
        const response = await fetch("/api/image-access-grants", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image_ids: missingImageIds,
            owner_user_id: post.created_by,
          }),
        });
        if (!response.ok || cancelled) {
          return;
        }
        const payload = (await response.json()) as { grants_by_id?: Record<string, string | null> };
        const merged: Record<string, string> = {};
        for (const [id, grant] of Object.entries(payload.grants_by_id ?? {})) {
          if (grant) {
            merged[id] = grant;
          }
        }
        if (!cancelled) {
          setImageGrantById((previous) => ({ ...previous, ...merged }));
        }
      } finally {
        if (!cancelled) {
          setIsLoadingImageGrants(false);
        }
      }
    };
    void loadImageGrants();
    return () => {
      cancelled = true;
    };
  }, [imageIds, post.created_by, post.id, post.image_access_grant, post.image_id]);

  useEffect(() => {
    if (customEmojiUuids.length === 0) {
      setCustomEmojiByUuid({});
      return;
    }

    let cancelled = false;
    const resolveCustomEmojis = async () => {
      try {
        const merged = await resolveEmojisByUuid(customEmojiUuids);
        if (!cancelled) {
          setCustomEmojiByUuid(merged);
        }
      } catch {
        // Ignore failures; custom emoji reaction falls back to token text.
      }
    };
    void resolveCustomEmojis();
    return () => {
      cancelled = true;
    };
  }, [customEmojiUuids]);

  const reactionEntries = useMemo(() => {
    return Object.entries(comments ?? {})
      .filter(([, comment]) => isEmojiOnlyComment(comment.text))
      .map(([, comment]) => ({
        emoji: comment.text.trim(),
        username: comment.username || comment.user_id,
        userId: comment.user_id,
      }));
  }, [comments]);

  const hasImages = imageIds.length > 0;

  const onDownloadImage = useCallback(async (imageId: string, index: number) => {
    if (downloadingImageId) {
      return;
    }

    const grant = imageGrantById[imageId];
    if (!grant) {
      return;
    }

    setDownloadingImageId(imageId);
    setDownloadStatusMessage("");
    try {
      const blob = await getImageBlob({
        imageId,
        grant,
        storageUserId: post.created_by,
      });
      if (!blob) {
        setDownloadStatusMessage("Could not download image. Try again in a moment.");
        return;
      }

      const baseFilename = imageIds.length === 1 ? `post-${post.id}` : `post-${post.id}-${index + 1}`;
      const didDownload = await downloadImageBlobWithExtension(blob, baseFilename);
      if (didDownload) {
        setDownloadStatusMessage("Image saved.");
      }
    } catch {
      setDownloadStatusMessage("Could not download image.");
    } finally {
      setDownloadingImageId(null);
    }
  }, [downloadingImageId, imageGrantById, imageIds.length, post.created_by, post.id]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-primary-background">
      <div className="flex items-center justify-between border-b border-accent-1 px-3 py-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-accent-2 transition hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          Back
        </button>
        <h1 className="text-lg font-semibold text-foreground">Post</h1>
        <div className="w-20" />
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain touch-pan-y px-4 py-4">
        {hasImages ? (
          <section className="mb-4">
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-accent-2">Images</h2>
            <p className="mb-2 text-xs text-accent-2">Tap an image to save it.</p>
            <div className="grid grid-cols-4 gap-1">
              {imageIds.map((imageId, index) => {
                const grant = imageGrantById[imageId];
                const isDownloading = downloadingImageId === imageId;
                return (
                  <button
                    key={imageId}
                    type="button"
                    onClick={() => {
                      void onDownloadImage(imageId, index);
                    }}
                    disabled={!grant || downloadingImageId !== null}
                    className="relative aspect-square overflow-hidden rounded-md border border-accent-1 bg-secondary-background p-0 transition enabled:hover:border-accent-2 disabled:opacity-60"
                    aria-label={`Download image ${index + 1}`}
                  >
                    {grant ? (
                      <CachedImage
                        imageId={imageId}
                        imageAccessGrant={grant}
                        imageStorageUserId={post.created_by}
                        alt={`Post image ${index + 1}`}
                        className="pointer-events-none h-full w-full object-cover"
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center px-1 text-center text-[10px] leading-tight text-accent-2">
                        {isLoadingImageGrants ? "Loading..." : "Unavailable"}
                      </span>
                    )}
                    {isDownloading ? (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-[10px] font-medium text-white">
                        Saving...
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            {downloadStatusMessage ? (
              <p className="mt-2 text-xs text-accent-2">{downloadStatusMessage}</p>
            ) : null}
          </section>
        ) : null}

        {reactionEntries.length > 0 ? (
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-accent-2">Reactions</h2>
            <ul className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-x-8 gap-y-2">
              {reactionEntries.map((entry, index) => (
                <li
                  key={`${entry.userId}-${entry.emoji}-${index}`}
                  className="contents"
                >
                  <div className="flex h-8 w-10 items-center justify-center">
                    <RenderReactionEmoji
                      value={entry.emoji}
                      customEmojiByUuid={customEmojiByUuid}
                    />
                  </div>
                  <div className="flex min-w-0 items-center gap-3">
                    <UserProfileImage
                      userId={entry.userId}
                      sizePx={32}
                      alt={`${entry.username} profile`}
                    />
                    {onViewUserProfile ? (
                      <button
                        type="button"
                        onClick={() => {
                          onViewUserProfile(entry.userId);
                          onBack();
                        }}
                        className="min-w-0 truncate text-sm font-medium text-foreground underline-offset-2 hover:underline"
                      >
                        {entry.username}
                      </button>
                    ) : (
                      <span className="min-w-0 truncate text-sm font-medium text-foreground">
                        {entry.username}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : !hasImages ? (
          <p className="text-sm text-accent-2">No reactions yet.</p>
        ) : null}
      </div>
    </div>
  );
}
