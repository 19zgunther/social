"use client";

import { TouchEvent, WheelEvent, useCallback, useEffect, useRef, useState } from "react";
import PostSection from "@/app/components/PostSection";
import { ApiError, FeedPostsListResponse, PostItem } from "@/app/types/interfaces";

const AUTH_TOKEN_KEY = "auth_token";
const FEED_CACHE_KEY = "feed_cache_v1";
const TOP_REFRESH_COOLDOWN_MS = 1500;
const PULL_REFRESH_THRESHOLD_PX = 55;

type FeedCachePayload = FeedPostsListResponse & {
  cached_at: number;
};

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

const readFeedCache = (): FeedCachePayload | null => {
  try {
    const raw = window.localStorage.getItem(FEED_CACHE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<FeedCachePayload>;
    if (
      !parsed ||
      !Array.isArray(parsed.posts) ||
      typeof parsed.has_more !== "boolean" ||
      (typeof parsed.next_cursor_post_id !== "string" && parsed.next_cursor_post_id !== null)
    ) {
      return null;
    }
    return {
      posts: parsed.posts as PostItem[],
      has_more: parsed.has_more,
      next_cursor_post_id: parsed.next_cursor_post_id,
      cached_at: typeof parsed.cached_at === "number" ? parsed.cached_at : Date.now(),
    };
  } catch {
    return null;
  }
};

const writeFeedCache = (payload: FeedPostsListResponse): void => {
  try {
    const cachePayload: FeedCachePayload = {
      ...payload,
      cached_at: Date.now(),
    };
    window.localStorage.setItem(FEED_CACHE_KEY, JSON.stringify(cachePayload));
  } catch {
    // Best effort cache write only.
  }
};

export default function Feed() {
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshingLatest, setIsRefreshingLatest] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursorPostId, setNextCursorPostId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [didHydrateFromCache, setDidHydrateFromCache] = useState(false);
  const feedContainerRef = useRef<HTMLDivElement | null>(null);
  const pullStartYRef = useRef<number | null>(null);
  const pullRefreshTriggeredRef = useRef(false);
  const lastTopRefreshAtRef = useRef(0);

  const loadPosts = useCallback(
    async ({
      cursorPostId,
      showLoadingState = true,
      showRefreshIndicator = false,
    }: {
      cursorPostId?: string;
      showLoadingState?: boolean;
      showRefreshIndicator?: boolean;
    } = {}) => {
      if (cursorPostId) {
        setIsLoadingMore(true);
      } else if (showRefreshIndicator) {
        setIsRefreshingLatest(true);
      } else if (showLoadingState) {
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

        const payload = (await response.json()) as FeedPostsListResponse;
        setHasMore(payload.has_more);
        setNextCursorPostId(payload.next_cursor_post_id);

        if (cursorPostId) {
          setPosts((previousPosts) => {
            const mergedPosts = [...previousPosts, ...payload.posts];
            writeFeedCache({
              posts: mergedPosts,
              has_more: payload.has_more,
              next_cursor_post_id: payload.next_cursor_post_id,
            });
            return mergedPosts;
          });
        } else {
          setPosts(payload.posts);
          writeFeedCache(payload);
        }
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : "Failed to load feed.");
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
        setIsRefreshingLatest(false);
      }
    },
    [],
  );

  const triggerTopRefresh = useCallback(() => {
    const now = Date.now();
    if (
      isLoading ||
      isLoadingMore ||
      isRefreshingLatest ||
      now - lastTopRefreshAtRef.current < TOP_REFRESH_COOLDOWN_MS
    ) {
      return;
    }
    lastTopRefreshAtRef.current = now;
    void loadPosts({ showLoadingState: false, showRefreshIndicator: true });
  }, [isLoading, isLoadingMore, isRefreshingLatest, loadPosts]);

  const onFeedTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    pullStartYRef.current = event.touches[0]?.clientY ?? null;
    pullRefreshTriggeredRef.current = false;
  };

  const onFeedTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    if (pullRefreshTriggeredRef.current) {
      return;
    }
    const startY = pullStartYRef.current;
    const currentY = event.touches[0]?.clientY;
    const container = feedContainerRef.current;
    if (startY === null || currentY === undefined || !container) {
      return;
    }
    if (container.scrollTop > 0) {
      return;
    }
    const deltaY = currentY - startY;
    if (deltaY >= PULL_REFRESH_THRESHOLD_PX) {
      pullRefreshTriggeredRef.current = true;
      triggerTopRefresh();
    }
  };

  const resetPullGesture = () => {
    pullStartYRef.current = null;
    pullRefreshTriggeredRef.current = false;
  };

  const onFeedWheel = (event: WheelEvent<HTMLDivElement>) => {
    const container = feedContainerRef.current;
    if (!container) {
      return;
    }
    if (container.scrollTop <= 0 && event.deltaY < -30) {
      triggerTopRefresh();
    }
  };

  useEffect(() => {
    const cached = readFeedCache();
    if (cached) {
      setPosts(cached.posts);
      setHasMore(cached.has_more);
      setNextCursorPostId(cached.next_cursor_post_id);
      setIsLoading(false);
      setDidHydrateFromCache(true);
    }

    void loadPosts({
      showLoadingState: !cached,
      showRefreshIndicator: Boolean(cached),
    });
  }, [loadPosts]);

  const showTopRefreshIndicator = isRefreshingLatest && didHydrateFromCache && posts.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-primary-background">
      <div
        ref={feedContainerRef}
        onTouchStart={onFeedTouchStart}
        onTouchMove={onFeedTouchMove}
        onTouchEnd={resetPullGesture}
        onTouchCancel={resetPullGesture}
        onWheel={onFeedWheel}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y"
      >
        {isLoading ? (
          <div className="px-3 py-3 text-xs text-accent-2">Loading feed...</div>
        ) : null}
        {!isLoading && posts.length === 0 ? (
          <div className="px-3 py-3 text-xs text-accent-2">No posts yet.</div>
        ) : null}

        {showTopRefreshIndicator ? (
          <div className="px-3 py-2">
            <div className="flex items-center gap-2 rounded-lg border border-accent-1 bg-secondary-background px-3 py-2">
              <span
                aria-hidden
                className="h-3 w-3 animate-spin rounded-full border-2 border-accent-2 border-t-transparent"
              />
              <p className="text-xs text-accent-2">Refreshing feed...</p>
            </div>
          </div>
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
                  void loadPosts({ cursorPostId: nextCursorPostId });
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
