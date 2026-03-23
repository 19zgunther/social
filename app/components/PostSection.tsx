"use client";

import { memo, UIEvent, useEffect, useMemo, useState } from "react";
import { Heart, ChevronDown, Trash2 } from "lucide-react";
import ImageViewerModal from "@/app/components/ImageViewerModal";
import CachedImage from "@/app/components/utils/CachedImage";
import UserProfileImage from "@/app/components/UserProfileImage";
import EmojiPicker from "@/app/components/utils/EmojiPicker";
import { ApiError, PostCommentNode, PostData, PostItem } from "@/app/types/interfaces";
import { DONT_SWIPE_TABS_CLASSNAME } from "./utils/useSwipeBack";

type PostSectionProps = {
  post: PostItem;
  currentUserId?: string | null;
  showComments?: boolean;
  className?: string;
  onViewUserProfile?: (userId: string) => void;
  onPostUpdated?: (updated: {
    id: string;
    data?: PostData | null;
    like_count?: number;
    is_liked_by_viewer?: boolean;
  }) => void;
};

const COMMENT_PATH_SEPARATOR = ">";
const EMOJI_ONLY_COMMENT_REGEX = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\uFE0F|\u200D|\s)+$/u;
const HAS_EMOJI_REGEX = /\p{Extended_Pictographic}/u;

const formatPostDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const isEmojiOnlyComment = (value: string): boolean => {
  const trimmed = value.trim();
  return Boolean(trimmed) && EMOJI_ONLY_COMMENT_REGEX.test(trimmed) && HAS_EMOJI_REGEX.test(trimmed);
};

function PostSectionComponent({
  post,
  currentUserId,
  showComments = true,
  className,
  onViewUserProfile,
  onPostUpdated,
}: PostSectionProps) {
  const [postData, setPostData] = useState<PostData>(post.data ?? {});
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [isLoadingAdditionalImages, setIsLoadingAdditionalImages] = useState(false);
  const [hasLoadedAdditionalImages, setHasLoadedAdditionalImages] = useState(false);
  const [imageUrlById, setImageUrlById] = useState<Record<string, string | null>>(
    post.image_id ? { [post.image_id]: post.image_url ?? null } : {},
  );
  const initialLikes = useMemo(() => postData.likes ?? {}, [postData.likes]);
  const [isLikedByViewer, setIsLikedByViewer] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [isUpdatingLike, setIsUpdatingLike] = useState(false);
  const [rootCommentDraft, setRootCommentDraft] = useState("");
  const [replyDraftByPath, setReplyDraftByPath] = useState<Record<string, string>>({});
  const [activeReplyPath, setActiveReplyPath] = useState<string | null>(null);
  const [expandedReplyPaths, setExpandedReplyPaths] = useState<string[]>([]);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [isDeletingCommentPath, setIsDeletingCommentPath] = useState<string | null>(null);
  const [imageViewer, setImageViewer] = useState<{
    signedUrl: string;
    imageId: string | null;
    alt: string;
  } | null>(null);

  const rootCommentEntries = useMemo(
    () =>
      Object.entries(postData.comments ?? {}).sort(([a], [b]) => {
        if (a === b) {
          return 0;
        }
        return a > b ? -1 : 1;
      }),
    [postData.comments],
  );
  const rootTextCommentEntries = useMemo(
    () => rootCommentEntries.filter(([, comment]) => !isEmojiOnlyComment(comment.text)),
    [rootCommentEntries],
  );
  const rootEmojiReactions = useMemo(
    () =>
      rootCommentEntries
        .filter(([, comment]) => isEmojiOnlyComment(comment.text))
        .map(([, comment]) => comment.text.trim()),
    [rootCommentEntries],
  );
  const allPostImageIds = useMemo(() => {
    const ids: string[] = [];
    if (post.image_id) {
      ids.push(post.image_id);
    }
    for (const imageId of postData.other_image_ids ?? []) {
      if (!imageId || ids.includes(imageId)) {
        continue;
      }
      ids.push(imageId);
    }
    return ids;
  }, [post.image_id, postData.other_image_ids]);
  const hasMultipleImages = allPostImageIds.length > 1;

  useEffect(() => {
    setPostData(post.data ?? {});
    setActiveImageIndex(0);
    setIsLoadingAdditionalImages(false);
    setHasLoadedAdditionalImages(false);
    setImageUrlById(post.image_id ? { [post.image_id]: post.image_url ?? null } : {});
    setRootCommentDraft("");
    setReplyDraftByPath({});
    setActiveReplyPath(null);
    setExpandedReplyPaths([]);
    setImageViewer(null);
  }, [post.data, post.id, post.image_id, post.image_url]);

  useEffect(() => {
    const fallbackLikeCount = Object.values(initialLikes).filter(Boolean).length;
    setLikeCount(post.like_count ?? fallbackLikeCount);
    setIsLikedByViewer(Boolean(post.is_liked_by_viewer));
  }, [initialLikes, post.is_liked_by_viewer, post.like_count]);

  const loadAdditionalImages = async () => {
    if (!hasMultipleImages || hasLoadedAdditionalImages || isLoadingAdditionalImages) {
      return;
    }
    const additionalImageIds = allPostImageIds.slice(1);
    if (additionalImageIds.length === 0) {
      setHasLoadedAdditionalImages(true);
      return;
    }

    setIsLoadingAdditionalImages(true);
    try {
      const response = await fetch("/api/image-urls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_ids: additionalImageIds,
          owner_user_id: post.created_by,
        }),
      });
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as { image_urls_by_id?: Record<string, string | null> };
      setImageUrlById((previous) => ({ ...previous, ...(payload.image_urls_by_id ?? {}) }));
      setHasLoadedAdditionalImages(true);
    } finally {
      setIsLoadingAdditionalImages(false);
    }
  };

  const onCarouselScroll = (event: UIEvent<HTMLDivElement>) => {
    const container = event.currentTarget;
    const width = container.clientWidth;
    if (width <= 0) {
      return;
    }
    const nextIndex = Math.round(container.scrollLeft / width);
    if (nextIndex !== activeImageIndex) {
      setActiveImageIndex(nextIndex);
    }
    if (nextIndex >= 1) {
      void loadAdditionalImages();
    }
  };

  const onToggleLike = async () => {
    if (isUpdatingLike) {
      return;
    }

    const nextLikedState = !isLikedByViewer;
    const previousLikedState = isLikedByViewer;
    const previousLikeCount = likeCount;
    setIsLikedByViewer(nextLikedState);
    setLikeCount((previous) => Math.max(0, previous + (nextLikedState ? 1 : -1)));
    setIsUpdatingLike(true);

    try {
      const response = await fetch("/api/feed-post-like", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          post_id: post.id,
          like: nextLikedState,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiError;
        throw new Error(body.error?.message ?? "Failed to update like.");
      }

      const payload = (await response.json()) as {
        like_count?: number;
        is_liked_by_viewer?: boolean;
        data?: PostData | null;
      };
      setIsLikedByViewer(Boolean(payload.is_liked_by_viewer ?? nextLikedState));
      setLikeCount(payload.like_count ?? previousLikeCount);
      if (payload.data) {
        setPostData(payload.data);
      }
      if (onPostUpdated) {
        onPostUpdated({
          id: post.id,
          like_count: payload.like_count,
          is_liked_by_viewer: payload.is_liked_by_viewer,
          data: payload.data,
        });
      }
    } catch {
      setIsLikedByViewer(previousLikedState);
      setLikeCount(previousLikeCount);
    } finally {
      setIsUpdatingLike(false);
    }
  };

  const onSubmitComment = async (parentPath: string[], emoji?: string) => {
    const pathKey = parentPath.join(COMMENT_PATH_SEPARATOR);
    const draft = parentPath.length === 0 ? rootCommentDraft : replyDraftByPath[pathKey] ?? "";
    const message = emoji ?? draft.trim();
    if (!message || isSubmittingComment) {
      return;
    }

    setIsSubmittingComment(true);
    try {
      const response = await fetch("/api/feed-post-comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          post_id: post.id,
          parent_path: parentPath,
          message,
        }),
      });
      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as { data?: PostData | null };
      setPostData(payload.data ?? {});
      if (onPostUpdated) {
        onPostUpdated({
          id: post.id,
          data: payload.data ?? {},
        });
      }
      if (parentPath.length === 0) {
        setRootCommentDraft("");
      } else {
        setReplyDraftByPath((previous) => ({
          ...previous,
          [pathKey]: "",
        }));
      }
      setActiveReplyPath(null);
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const toggleReplies = (pathKey: string) => {
    setAboutToDeleteCommentPath(null);
    setExpandedReplyPaths((previous) =>
      previous.includes(pathKey) ? previous.filter((item) => item !== pathKey) : [...previous, pathKey],
    );
  };


  const handlePostEmojiReply = (emoji: string, path?: string[]) => {
    void onSubmitComment(path ?? [], emoji);
  };

  const [aboutToDeleteCommentPath, setAboutToDeleteCommentPath] = useState<string | null>(null);

  const onDeleteComment = async (commentPath: string[]) => {
    const pathKey = commentPath.join(COMMENT_PATH_SEPARATOR);
    if (!pathKey || isDeletingCommentPath) {
      return;
    }

    if (!aboutToDeleteCommentPath || aboutToDeleteCommentPath !== pathKey) {
      setAboutToDeleteCommentPath(pathKey);
      return;
    }

    setIsDeletingCommentPath(pathKey);
    try {
      const response = await fetch("/api/feed-post-comment", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          post_id: post.id,
          comment_path: commentPath,
        }),
      });
      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as { data?: PostData | null };
      setPostData(payload.data ?? {});
      if (onPostUpdated) {
        onPostUpdated({
          id: post.id,
          data: payload.data ?? {},
        });
      }

      setActiveReplyPath((previous) => (previous === pathKey ? null : previous));
      setReplyDraftByPath((previous) => {
        if (!previous[pathKey]) {
          return previous;
        }
        const next = { ...previous };
        delete next[pathKey];
        return next;
      });
      setExpandedReplyPaths((previous) =>
        previous.filter(
          (expandedPath) =>
            expandedPath !== pathKey && !expandedPath.startsWith(`${pathKey}${COMMENT_PATH_SEPARATOR}`),
        ),
      );
    } finally {
      setIsDeletingCommentPath(null);
    }
  };

  const renderCommentTree = (
    commentTimestamp: string,
    comment: PostCommentNode,
    parentPath: string[],
    depth: number,
  ) => {
    const path = [...parentPath, commentTimestamp];
    const pathKey = path.join(COMMENT_PATH_SEPARATOR);
    const allReplyEntries = Object.entries(comment.replies ?? {}).sort(([a], [b]) => (a > b ? 1 : -1));
    const emojiReplyEntries = allReplyEntries.filter(([, childComment]) =>
      isEmojiOnlyComment(childComment.text),
    );
    const threadedReplyEntries = allReplyEntries.filter(([, childComment]) =>
      !isEmojiOnlyComment(childComment.text),
    );
    const hasThreadedReplies = threadedReplyEntries.length > 0;
    const isExpanded = expandedReplyPaths.includes(pathKey);
    const isReplyInputOpen = activeReplyPath === pathKey;
    const replyDraft = replyDraftByPath[pathKey] ?? "";
    const canDeleteReply = depth > 0 && Boolean(currentUserId) && comment.user_id === currentUserId;

    return (
      <div key={pathKey} className={`${depth > 0 ? "ml-4 border-l border-accent-1/70 pl-2" : ""}`}>
        <div className="text-sm text-accent-2 flex">
          <span className="font-semibold text-foreground/90 pr-2">{comment.username || comment.user_id}</span>

          {comment.text}

          {canDeleteReply && <button className="ml-auto" onClick={() => { void onDeleteComment(path); }} disabled={isDeletingCommentPath === pathKey}>
            <Trash2 className={`h-4 w-4 ${aboutToDeleteCommentPath === pathKey ? "text-red-400" : "text-accent-2 opacity-30"}`} />
          </button>}
        </div>
        {emojiReplyEntries.length > 0 ? (
          <div className="mt-1 ml-10 flex flex-wrap items-center gap-1">
            {emojiReplyEntries.map(([childTimestamp, childComment]) => (
              <span key={childTimestamp} className="text-base leading-none">
                {childComment.text.trim()}
              </span>
            ))}
          </div>
        ) : null}
        <div className="mt-1 ml-10 flex items-center gap-5">

          {hasThreadedReplies ? (
            <button
              type="button"
              onClick={() => toggleReplies(pathKey)}
              className="text-xs flex text-accent-2 underline underline-offset-2 hover:text-foreground opacity-50"
            >
              <ChevronDown className={`h-4 w-4 ${isExpanded ? "rotate-180" : ""}`} />
              {isExpanded
                ? "Hide replies"
                : `${threadedReplyEntries.length} repl${threadedReplyEntries.length === 1 ? "y" : "ies"}`}
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => setActiveReplyPath(isReplyInputOpen ? null : pathKey)}
            className="text-xs text-accent-2 underline underline-offset-2 hover:text-foreground opacity-50"
          >
            Reply
          </button>

          <EmojiPicker
            onSelectEmoji={(emoji) => handlePostEmojiReply(emoji, path)}
            buttonClassName="h-5 border-none pt-0.5"
          />
        </div>


        {isReplyInputOpen ? (
          <div className="mt-1 flex items-center gap-2">
            <input
              value={replyDraft}
              onChange={(event) =>
                setReplyDraftByPath((previous) => ({
                  ...previous,
                  [pathKey]: event.target.value,
                }))
              }
              placeholder="Write a reply..."
              className="flex-1 rounded-lg border border-accent-1 bg-secondary-background px-2 py-1 text-sm text-foreground outline-none focus:border-accent-2"
            />
            <button
              type="button"
              onClick={() => {
                void onSubmitComment(path);
              }}
              disabled={isSubmittingComment}
              className="rounded-lg border border-accent-1 px-2 py-1 text-xs text-accent-2 hover:text-foreground disabled:opacity-50"
            >
              Send
            </button>
          </div>
        ) : null}
        {hasThreadedReplies && isExpanded ? (
          <div className="mt-1 space-y-2">
            {threadedReplyEntries.map(([childTimestamp, childComment]) =>
              renderCommentTree(childTimestamp, childComment, path, depth + 1),
            )}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <article className={`w-full border-t border-accent-1 bg-primary-background mb-10 ${className ?? ""} ${hasMultipleImages ? DONT_SWIPE_TABS_CLASSNAME: ""}`}>
      <header className="px-2 py-2">
        <div className="flex items-center gap-2">
          <UserProfileImage
            userId={post.created_by}
            sizePx={40}
            alt={`${post.username} profile`}
            signedUrl={post.author_profile_image_url}
            imageId={post.author_profile_image_id ?? null}
          />
          {onViewUserProfile ? (
            <button
              type="button"
              onClick={() => onViewUserProfile(post.created_by)}
              className="text-sm font-semibold text-foreground hover:underline"
            >
              {post.username}
            </button>
          ) : (
            <p className="text-sm font-semibold text-foreground">{post.username}</p>
          )}
          <p className="text-[11px] text-accent-2">{formatPostDate(post.created_at)}</p>
        </div>

      </header>
      {allPostImageIds.length > 0 ? (
        <div
          className="flex w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain scroll-smooth"
          onScroll={onCarouselScroll}
          onTouchStart={() => {
            void loadAdditionalImages();
          }}
          onMouseDown={() => {
            void loadAdditionalImages();
          }}
        >
          {allPostImageIds.map((imageId, index) => {
            const signedUrl = imageUrlById[imageId] ?? null;
            const isPrimaryImage = index === 0;
            return (
              <div key={imageId} className="w-full shrink-0 snap-center">
                {signedUrl ? (
                  <button
                    type="button"
                    className="block w-full cursor-zoom-in border-0 bg-transparent p-0"
                    onClick={(event) => {
                      event.stopPropagation();
                      setImageViewer({
                        signedUrl,
                        imageId,
                        alt: "Post attachment",
                      });
                    }}
                  >
                    <CachedImage
                      signedUrl={signedUrl}
                      imageId={imageId}
                      alt="Post attachment"
                      className="pointer-events-none aspect-square w-full overflow-hidden object-cover"
                    />
                  </button>
                ) : (
                  <div className="flex h-full w-full aspect-square items-center justify-center border-y border-accent-1 bg-secondary-background text-xs text-accent-2">
                    {isPrimaryImage || isLoadingAdditionalImages ? "Loading image..." : "Swipe to load image"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      {/** Post Content */}
      <div className="px-3 py-1">
        {hasMultipleImages ? (
          <div className="mb-2 flex justify-center gap-1">
            {allPostImageIds.map((imageId, index) => (
              <span
                key={`${imageId}-dot`}
                className={`h-1.5 w-1.5 rounded-full transition ${
                  index === activeImageIndex ? "bg-foreground" : "bg-accent-1"
                }`}
              />
            ))}
          </div>
        ) : null}

        {/** Post Text */}
        {post.text.trim() ? <p className="text-sm text-foreground">{post.text}</p> : null}

        {/** Like Button */}
        <div className="mt-1 flex items-center gap-2">

          <button
            type="button"
            onClick={() => {
              void onToggleLike();
            }}
            disabled={isUpdatingLike}
            className="h-5 inline-flex items-center gap-1 rounded-lg px-1 py-1 text-xs text-accent-2 transition hover:text-foreground disabled:opacity-50"
          >
            <Heart
              className={`h-4 w-4 ${isLikedByViewer ? "fill-accent-3 text-accent-3" : "text-accent-2"}`}
            />
            <span>{likeCount}</span>
          </button>

          <EmojiPicker
            onSelectEmoji={handlePostEmojiReply}
            buttonClassName="h-5 border-none pt-0.5"
          />

          {rootEmojiReactions.length > 0 ? (
            <div className="flex max-w-[60%] flex-wrap items-center gap-0">
              {rootEmojiReactions.map((emoji, index) => (
                <span key={`${emoji}-${index}`} className="text-base leading-none">
                  {emoji}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {/** Comments */}
        {showComments ? (
          <div className="mt-1 space-y-1">

            {/** Add Comment Input */}
            <div className="flex items-center gap-2">
              <input
                value={rootCommentDraft}
                onChange={(event) => setRootCommentDraft(event.target.value)}
                placeholder="Add a comment..."
                className="flex-1 rounded-lg border border-accent-1 bg-primary-background px-2 py-2 text-sm text-foreground outline-none focus:border-accent-2"
              />
              <button
                type="button"
                onClick={() => {
                  void onSubmitComment([]);
                }}
                disabled={isSubmittingComment}
                className="rounded-lg border border-accent-1 px-2 py-1 text-xs text-accent-2 hover:text-foreground disabled:opacity-50"
              >
                Send
              </button>
            </div>

            {/** Comment Tree */}
            {rootTextCommentEntries.length === 0 ? (
              <p className="text-xs text-accent-2">No comments yet.</p>
            ) : (
              <div className="space-y-2">
                {rootTextCommentEntries.map(([commentTimestamp, comment]) =>
                  renderCommentTree(commentTimestamp, comment, [], 0),
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <ImageViewerModal
        key={
          imageViewer
            ? `${imageViewer.signedUrl}-${imageViewer.imageId ?? ""}`
            : "post-image-viewer-closed"
        }
        open={imageViewer !== null}
        onClose={() => setImageViewer(null)}
        signedUrl={imageViewer?.signedUrl ?? null}
        imageId={imageViewer?.imageId ?? null}
        alt={imageViewer?.alt}
      />
    </article>
  );
}

export const PostSection = memo(PostSectionComponent);