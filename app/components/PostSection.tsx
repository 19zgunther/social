"use client";

import { useEffect, useMemo, useState } from "react";
import { Heart, ChevronDown, CircleUserRound } from "lucide-react";
import CachedImage from "@/app/components/utils/CachedImage";
import { ApiError, PostCommentNode, PostData, PostItem } from "@/app/types/interfaces";

type PostSectionProps = {
  post: PostItem;
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

export default function PostSection({
  post,
  showComments = true,
  className,
  onViewUserProfile,
  onPostUpdated,
}: PostSectionProps) {
  const [postData, setPostData] = useState<PostData>(post.data ?? {});
  const initialLikes = useMemo(() => postData.likes ?? {}, [postData.likes]);
  const [isLikedByViewer, setIsLikedByViewer] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [isUpdatingLike, setIsUpdatingLike] = useState(false);
  const [rootCommentDraft, setRootCommentDraft] = useState("");
  const [replyDraftByPath, setReplyDraftByPath] = useState<Record<string, string>>({});
  const [activeReplyPath, setActiveReplyPath] = useState<string | null>(null);
  const [expandedReplyPaths, setExpandedReplyPaths] = useState<string[]>([]);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);

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

  useEffect(() => {
    setPostData(post.data ?? {});
    setRootCommentDraft("");
    setReplyDraftByPath({});
    setActiveReplyPath(null);
    setExpandedReplyPaths([]);
  }, [post.data, post.id]);

  useEffect(() => {
    const fallbackLikeCount = Object.values(initialLikes).filter(Boolean).length;
    setLikeCount(post.like_count ?? fallbackLikeCount);
    setIsLikedByViewer(Boolean(post.is_liked_by_viewer));
  }, [initialLikes, post.is_liked_by_viewer, post.like_count]);

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
        headers: { "Content-Type": "application/json"},
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

  const onSubmitComment = async (parentPath: string[]) => {
    const pathKey = parentPath.join(COMMENT_PATH_SEPARATOR);
    const draft = parentPath.length === 0 ? rootCommentDraft : replyDraftByPath[pathKey] ?? "";
    const message = draft.trim();
    if (!message || isSubmittingComment) {
      return;
    }

    setIsSubmittingComment(true);
    try {
      const response = await fetch("/api/feed-post-comment", {
        method: "POST",
        headers: { "Content-Type": "application/json"},
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
    setExpandedReplyPaths((previous) =>
      previous.includes(pathKey) ? previous.filter((item) => item !== pathKey) : [...previous, pathKey],
    );
  };

  const renderCommentTree = (
    commentTimestamp: string,
    comment: PostCommentNode,
    parentPath: string[],
    depth: number,
  ) => {
    const path = [...parentPath, commentTimestamp];
    const pathKey = path.join(COMMENT_PATH_SEPARATOR);
    const replyEntries = Object.entries(comment.replies ?? {}).sort(([a], [b]) => (a > b ? -1 : 1));
    const hasReplies = replyEntries.length > 0;
    const isExpanded = expandedReplyPaths.includes(pathKey);
    const isReplyInputOpen = activeReplyPath === pathKey;
    const replyDraft = replyDraftByPath[pathKey] ?? "";

    return (
      <div key={pathKey} className={`${depth > 0 ? "ml-4 border-l border-accent-1/70 pl-2" : ""}`}>
        <div className="text-xs text-accent-2">
          <span className="font-semibold text-foreground/90">{comment.username || comment.user_id}</span>{" "}
          {comment.text}
        </div>
        <div className="mt-1 ml-10 flex items-center gap-5">
          
          {hasReplies ? (
            <button
              type="button"
              onClick={() => toggleReplies(pathKey)}
              className="text-[11px] flex text-accent-2 underline underline-offset-2 hover:text-foreground"
            >
              <ChevronDown className={`h-4 w-4 ${isExpanded ? "rotate-180" : ""}`} />
              {isExpanded ? "Hide replies" : `${replyEntries.length} repl${replyEntries.length === 1 ? "y" : "ies"}`}
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => setActiveReplyPath(isReplyInputOpen ? null : pathKey)}
            className="text-[11px] text-accent-2 underline underline-offset-2 hover:text-foreground"
          >
            Reply
          </button>

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
              className="flex-1 rounded-lg border border-accent-1 bg-secondary-background px-2 py-1 text-xs text-foreground outline-none focus:border-accent-2"
            />
            <button
              type="button"
              onClick={() => {
                void onSubmitComment(path);
              }}
              disabled={isSubmittingComment}
              className="rounded-lg border border-accent-1 px-2 py-1 text-[11px] text-accent-2 hover:text-foreground disabled:opacity-50"
            >
              Send
            </button>
          </div>
        ) : null}
        {hasReplies && isExpanded ? (
          <div className="mt-1 space-y-2">
            {replyEntries.map(([childTimestamp, childComment]) =>
              renderCommentTree(childTimestamp, childComment, path, depth + 1),
            )}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <article className={`w-full border-t border-accent-1 bg-primary-background mb-10 ${className ?? ""}`}>
      <header className="px-2 py-2">
        <div className="flex items-center gap-2">
          {post.author_profile_image_url ? (
            <CachedImage
              signedUrl={post.author_profile_image_url}
              imageId={post.author_profile_image_id ?? null}
              alt={`${post.username} profile`}
              className="h-10 w-10 rounded-full border border-accent-1 object-cover"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-accent-1 bg-secondary-background">
              <CircleUserRound className="h-4 w-4 text-accent-2" />
            </div>
          )}
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
      {post.image_url ? (
        <CachedImage
          signedUrl={post.image_url}
          imageId={post.image_id}
          alt="Post attachment"
          className="w-full aspect-square overflow-hidden border-y border-accent-1 object-cover"
        />
      ) : (
        <div className="h-40 w-full border-y border-accent-1 bg-secondary-background" />
      )}
      <div className="px-3 py-2">
        {post.text.trim() ? <p className="text-sm text-foreground">{post.text}</p> : null}
        <div className="mt-2">
          <button
            type="button"
            onClick={() => {
              void onToggleLike();
            }}
            disabled={isUpdatingLike}
            className="inline-flex items-center gap-1 rounded-lg border border-accent-1 px-2 py-1 text-xs text-accent-2 transition hover:text-foreground disabled:opacity-50"
          >
            <Heart
              className={`h-4 w-4 ${isLikedByViewer ? "fill-accent-3 text-accent-3" : "text-accent-2"}`}
            />
            <span>{likeCount}</span>
          </button>
        </div>
        {showComments ? (
          <div className="mt-2 space-y-1">
            <div className="flex items-center gap-2">
              <input
                value={rootCommentDraft}
                onChange={(event) => setRootCommentDraft(event.target.value)}
                placeholder="Add a comment..."
                className="flex-1 rounded-lg border border-accent-1 bg-secondary-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-accent-2"
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
            {rootCommentEntries.length === 0 ? (
              <p className="text-xs text-accent-2">No comments yet.</p>
            ) : (
              <div className="space-y-2">
                {rootCommentEntries.map(([commentTimestamp, comment]) =>
                  renderCommentTree(commentTimestamp, comment, [], 0),
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </article>
  );
}
