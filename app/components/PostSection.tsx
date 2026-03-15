"use client";

import { useEffect, useMemo, useState } from "react";
import { Heart } from "lucide-react";

export type PostComment = {
  id: string;
  created_by: string;
  username?: string;
  text: string;
  created_at?: string;
};

export type PostData = {
  comments?: PostComment[];
  likes?: Record<string, boolean>;
};

export type PostItem = {
  id: string;
  created_at: string;
  created_by: string;
  image_id: string | null;
  image_url: string | null;
  text: string;
  data: PostData | null;
  username: string;
  email: string | null;
};

type PostSectionProps = {
  post: PostItem;
  showComments?: boolean;
  className?: string;
};

type ApiError = {
  error?: {
    message?: string;
  };
};

const AUTH_TOKEN_KEY = "auth_token";

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

export default function PostSection({ post, showComments = true, className }: PostSectionProps) {
  const comments = Array.isArray(post.data?.comments) ? post.data?.comments ?? [] : [];
  const initialLikes = useMemo(() => post.data?.likes ?? {}, [post.data]);
  const [isLikedByViewer, setIsLikedByViewer] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [isUpdatingLike, setIsUpdatingLike] = useState(false);

  useEffect(() => {
    const token = window.localStorage.getItem(AUTH_TOKEN_KEY);
    const payloadPart = token?.split(".")[1];
    let viewerUserId = "";
    if (payloadPart) {
      try {
        const decoded = JSON.parse(atob(payloadPart.replace(/-/g, "+").replace(/_/g, "/"))) as {
          user_id?: string;
        };
        viewerUserId = decoded.user_id ?? "";
      } catch {
        viewerUserId = "";
      }
    }

    const nextLikeCount = Object.values(initialLikes).filter(Boolean).length;
    setLikeCount(nextLikeCount);
    setIsLikedByViewer(Boolean(viewerUserId && initialLikes[viewerUserId]));
  }, [initialLikes]);

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
      const token = window.localStorage.getItem(AUTH_TOKEN_KEY);
      if (!token) {
        throw new Error("Not authenticated.");
      }

      const response = await fetch("/api/feed-post-like", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
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
      };
      setIsLikedByViewer(Boolean(payload.is_liked_by_viewer ?? nextLikedState));
      setLikeCount(payload.like_count ?? previousLikeCount);
    } catch {
      setIsLikedByViewer(previousLikedState);
      setLikeCount(previousLikeCount);
    } finally {
      setIsUpdatingLike(false);
    }
  };

  return (
    <article className={`w-full border-t border-accent-1 bg-primary-background mb-10 ${className ?? ""}`}>
      <header className="px-3 py-2">
        <p className="text-sm font-semibold text-foreground">{post.username}</p>
        <p className="text-[11px] text-accent-2">{formatPostDate(post.created_at)}</p>
      </header>
      {post.image_url ? (
        <img src={post.image_url} alt="Post attachment" className="w-full aspect-square overflow-hidden border-y border-accent-1 object-cover" />
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
            {comments.length === 0 ? (
              <p className="text-xs text-accent-2">No comments yet.</p>
            ) : (
              comments.map((comment) => (
                <div key={comment.id} className="text-xs text-accent-2">
                  <span className="font-semibold text-foreground/90">
                    {comment.username ?? comment.created_by}
                  </span>{" "}
                  {comment.text}
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>
    </article>
  );
}
