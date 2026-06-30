"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download } from "lucide-react";
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
  const [isDownloadingImages, setIsDownloadingImages] = useState(false);
  const [downloadStatusMessage, setDownloadStatusMessage] = useState("");

  const comments = post.data?.comments;
  const imageIds = useMemo(() => buildImageIds(post), [post]);

  const customEmojiUuids = useMemo(() => collectCustomEmojiUuids(comments), [comments]);

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

  const groupedReactions = useMemo(() => {
    const entries = Object.entries(comments ?? {})
      .filter(([, comment]) => isEmojiOnlyComment(comment.text))
      .map(([, comment]) => ({
        emoji: comment.text.trim(),
        username: comment.username || comment.user_id,
        userId: comment.user_id,
      }));

    const byEmoji = new Map<
      string,
      { emoji: string; reactors: { username: string; userId: string }[] }
    >();

    for (const entry of entries) {
      const existing = byEmoji.get(entry.emoji);
      if (existing) {
        existing.reactors.push({ username: entry.username, userId: entry.userId });
      } else {
        byEmoji.set(entry.emoji, {
          emoji: entry.emoji,
          reactors: [{ username: entry.username, userId: entry.userId }],
        });
      }
    }

    return Array.from(byEmoji.values());
  }, [comments]);

  const hasImages = imageIds.length > 0;
  const downloadLabel = imageIds.length === 1 ? "Download image" : "Download images";

  const onDownloadImages = async () => {
    if (!hasImages || isDownloadingImages) {
      return;
    }

    setIsDownloadingImages(true);
    setDownloadStatusMessage("");
    try {
      const grants: Record<string, string> = {};
      if (post.image_id && post.image_access_grant) {
        grants[post.image_id] = post.image_access_grant;
      }

      const missingImageIds = imageIds.filter((imageId) => !grants[imageId]);
      if (missingImageIds.length > 0) {
        const response = await fetch("/api/image-access-grants", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image_ids: missingImageIds,
            owner_user_id: post.created_by,
          }),
        });
        if (response.ok) {
          const payload = (await response.json()) as { grants_by_id?: Record<string, string | null> };
          for (const [id, grant] of Object.entries(payload.grants_by_id ?? {})) {
            if (grant) {
              grants[id] = grant;
            }
          }
        }
      }

      let downloadedCount = 0;
      for (let index = 0; index < imageIds.length; index += 1) {
        const imageId = imageIds[index]!;
        const grant = grants[imageId];
        if (!grant) {
          continue;
        }

        const blob = await getImageBlob({
          imageId,
          grant,
          storageUserId: post.created_by,
        });
        if (!blob) {
          continue;
        }

        const baseFilename = imageIds.length === 1 ? `post-${post.id}` : `post-${post.id}-${index + 1}`;
        const didDownload = await downloadImageBlobWithExtension(blob, baseFilename);
        if (didDownload) {
          downloadedCount += 1;
        }
      }

      if (downloadedCount === 0) {
        setDownloadStatusMessage("Could not download images. Try again in a moment.");
      } else if (downloadedCount === 1) {
        setDownloadStatusMessage("Image saved.");
      } else {
        setDownloadStatusMessage(`${downloadedCount} images saved.`);
      }
    } catch {
      setDownloadStatusMessage("Could not download images.");
    } finally {
      setIsDownloadingImages(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-primary-background">
      <div className="flex items-center justify-between border-b border-accent-1 px-3 py-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-full flex gap-2 border border-accent-1 bg-secondary-background px-3 py-2 text-sm text-accent-2 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h1 className="text-lg font-semibold text-foreground">Post</h1>
        <div className="w-20" />
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain touch-pan-y px-4 py-4">
        {hasImages ? (
          <section className="mb-4">
            <button
              type="button"
              onClick={() => {
                void onDownloadImages();
              }}
              disabled={isDownloadingImages}
              className="flex w-full items-center gap-3 rounded-lg border border-accent-1 bg-secondary-background px-3 py-3 text-left text-sm text-foreground transition hover:border-accent-2 disabled:opacity-50"
            >
              <Download className="h-5 w-5 shrink-0 text-accent-2" />
              <span>{isDownloadingImages ? "Downloading..." : downloadLabel}</span>
            </button>
            {downloadStatusMessage ? (
              <p className="mt-2 text-xs text-accent-2">{downloadStatusMessage}</p>
            ) : null}
          </section>
        ) : null}

        {groupedReactions.length > 0 ? (
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-accent-2">Reactions</h2>
            <ul className="space-y-3">
              {groupedReactions.map((group) => (
                <li
                  key={group.emoji}
                  className="flex items-start gap-3 rounded-lg border border-accent-1 bg-secondary-background px-3 py-2"
                >
                  <div className="shrink-0 pt-0.5">
                    <RenderReactionEmoji
                      value={group.emoji}
                      customEmojiByUuid={customEmojiByUuid}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">
                      {group.reactors.map((reactor, index) => (
                        <span key={`${reactor.userId}-${index}`}>
                          {index > 0 ? ", " : null}
                          {onViewUserProfile ? (
                            <button
                              type="button"
                              onClick={() => {
                                onViewUserProfile(reactor.userId);
                                onBack();
                              }}
                              className="font-medium text-foreground underline-offset-2 hover:underline"
                            >
                              {reactor.username}
                            </button>
                          ) : (
                            <span className="font-medium">{reactor.username}</span>
                          )}
                        </span>
                      ))}
                    </p>
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
