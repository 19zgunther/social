"use client";

import { useEffect, useState } from "react";
import PostSection, { PostItem } from "@/app/components/PostSection";

type ApiError = {
  error?: {
    code?: string;
    message?: string;
  };
};

const AUTH_TOKEN_KEY = "auth_token";

const postWithAuth = async (path: string, body: unknown): Promise<Response> => {
  const token = window.localStorage.getItem(AUTH_TOKEN_KEY);
  if (!token) {
    throw new Error("Not authenticated.");
  }

  return fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
};

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as ApiError;
    return body.error?.message ?? "Request failed.";
  } catch {
    return "Request failed.";
  }
};

export default function Feed() {
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursorPostId, setNextCursorPostId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  const loadPosts = async (cursorPostId?: string) => {
    if (cursorPostId) {
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
    }
    setStatusMessage("");

    try {
      const response = await postWithAuth("/api/feed-posts-list", {
        ...(cursorPostId ? { cursor_post_id: cursorPostId } : {}),
      });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }

      const payload = (await response.json()) as {
        posts: PostItem[];
        has_more: boolean;
        next_cursor_post_id: string | null;
      };
      setPosts((previousPosts) =>
        cursorPostId ? [...previousPosts, ...payload.posts] : payload.posts,
      );
      setHasMore(payload.has_more);
      setNextCursorPostId(payload.next_cursor_post_id);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to load feed.");
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    void loadPosts();
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-primary-background">
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y">
        {isLoading ? (
          <div className="px-3 py-3 text-xs text-accent-2">Loading feed...</div>
        ) : null}
        {!isLoading && posts.length === 0 ? (
          <div className="px-3 py-3 text-xs text-accent-2">No posts yet.</div>
        ) : null}

        {posts.map((post) => (
          <PostSection key={post.id} post={post} />
        ))}

        {hasMore ? (
          <div className="px-3 py-3">
            <button
              type="button"
              onClick={() => {
                if (nextCursorPostId && !isLoadingMore) {
                  void loadPosts(nextCursorPostId);
                }
              }}
              disabled={!nextCursorPostId || isLoadingMore}
              className="w-full rounded-lg border border-accent-1 bg-secondary-background px-3 py-2 text-xs font-medium text-accent-2 transition hover:text-foreground disabled:opacity-50"
            >
              {isLoadingMore ? "Loading..." : "Load more"}
            </button>
          </div>
        ) : null}

        {statusMessage ? <p className="px-3 py-2 text-xs text-accent-2">{statusMessage}</p> : null}
      </div>
    </div>
  );
}
