"use client";

import { TouchEvent, WheelEvent, useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { PostSection} from "@/app/components/PostSection";
import PostOptionsPane from "@/app/components/PostOptionsPane";
import { useSwipeBackOverride } from "@/app/components/utils/useSwipeBack";
import { ApiError, FeedPostsListResponse, PostItem, PostData } from "@/app/types/interfaces";
import { useStateCached } from "./useStateCached";
import { Plus } from "lucide-react";
import Loader from "@/app/components/Loader";
const FEED_CACHE_KEY = "feed_cache_v3";
const TOP_REFRESH_COOLDOWN_MS = 1500;
const PULL_REFRESH_THRESHOLD_PX = 55;


const postWithAuth = async (path: string, body: unknown): Promise<Response> =>
  fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as ApiError;
    return body.error?.message ?? "Request failed.";
  } catch {
    return "Request failed.";
  }
};


export default function Feed({
  onViewUserProfile,
  onOpenCreatePost,
  swipeBackOverrideRef,
}: {
  onViewUserProfile?: (userId: string) => void;
  onOpenCreatePost?: () => void;
  swipeBackOverrideRef: MutableRefObject<(() => void) | null>;
}) {
  const [posts, setPosts] = useStateCached<PostItem[]>([], FEED_CACHE_KEY);
  const [viewerUserId, setViewerUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshingLatest, setIsRefreshingLatest] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [postOptionsPostId, setPostOptionsPostId] = useState<string | null>(null);
  const [didHydrateFromCache, setDidHydrateFromCache] = useState(false);
  const feedContainerRef = useRef<HTMLDivElement | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const isLoadingMoreRef = useRef(false);
  const pullStartYRef = useRef<number | null>(null);
  const pullRefreshTriggeredRef = useRef(false);
  const lastTopRefreshAtRef = useRef(0);

  const loadPosts = useCallback(
    async ({
      cursor,
      showLoadingState = true,
      showRefreshIndicator = false,
    }: {
      cursor?: string;
      showLoadingState?: boolean;
      showRefreshIndicator?: boolean;
    } = {}) => {
      if (cursor) {
        if (isLoadingMoreRef.current) {
          return;
        }
        isLoadingMoreRef.current = true;
        setIsLoadingMore(true);
      } else if (showRefreshIndicator) {
        setIsRefreshingLatest(true);
      } else if (showLoadingState) {
        setIsLoading(true);
      }
      setStatusMessage("");

      try {
        const response = await postWithAuth("/api/feed-posts-list", {
          ...(cursor ? { cursor } : {}),
        });
        if (!response.ok) {
          setStatusMessage(await readErrorMessage(response));
          return;
        }

        const payload = (await response.json()) as FeedPostsListResponse;
        if (payload.viewer_user_id) {
          setViewerUserId(payload.viewer_user_id);
        }
        setHasMore(payload.has_more);
        setNextCursor(payload.next_cursor ?? payload.next_cursor_post_id);

        if (cursor) {
          setPosts((previousPosts) => {
            const mergedPosts = [...previousPosts, ...payload.posts];
            return mergedPosts;
          });
        } else {
          setPosts(payload.posts);
        }
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : "Failed to load feed.");
      } finally {
        isLoadingMoreRef.current = false;
        setIsLoading(false);
        setIsLoadingMore(false);
        setIsRefreshingLatest(false);
      }
    },
    [],
  );

  const onPostUpdated = useCallback(
    (updated: {
      id: string;
      data?: PostData | null;
      text?: string;
      like_count?: number;
      is_liked_by_viewer?: boolean;
    }) => {
      setPosts((previousPosts) =>
        previousPosts.map((post) => {
          if (post.id !== updated.id) {
            return post;
          }
          return {
            ...post,
            ...(updated.data !== undefined ? { data: updated.data } : {}),
            ...(updated.text !== undefined ? { text: updated.text } : {}),
            ...(updated.like_count !== undefined ? { like_count: updated.like_count } : {}),
            ...(updated.is_liked_by_viewer !== undefined
              ? { is_liked_by_viewer: updated.is_liked_by_viewer }
              : {}),
          };
        }),
      );
    },
    [setPosts],
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

  // Initial load of feed
  useEffect(() => {

    void loadPosts({
      showLoadingState: true,
      showRefreshIndicator: true,
    });
  }, [loadPosts]);

  const loadingFeedContentRef = useRef<HTMLDivElement>(null);
  const [loadingFeedHeight, setLoadingFeedHeight] = useState(0);
  const [loadingFeedTransitionMs, setLoadingFeedTransitionMs] = useState(1000);
  useEffect(() => {
    if (isLoading) {
      setLoadingFeedTransitionMs(700);
      const frameId = requestAnimationFrame(() => {
        const nextHeight = loadingFeedContentRef.current?.scrollHeight ?? 0;
        setLoadingFeedHeight(nextHeight > 0 ? nextHeight : 80);
      });
      return () => cancelAnimationFrame(frameId);
    }
    setLoadingFeedTransitionMs(1000);
    setLoadingFeedHeight(0);
  }, [isLoading]);

  const loadMorePosts = useCallback(() => {
    if (!nextCursor || isLoadingMoreRef.current || isLoading) {
      return;
    }
    void loadPosts({ cursor: nextCursor });
  }, [isLoading, loadPosts, nextCursor]);

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    const root = feedContainerRef.current;
    if (!sentinel || !root || !hasMore) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMorePosts();
        }
      },
      { root, rootMargin: "120px 0px", threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMorePosts, posts.length]);

  const showTopRefreshIndicator = isRefreshingLatest && didHydrateFromCache && posts.length > 0;

  const postOptionsPost = postOptionsPostId
    ? posts.find((post) => post.id === postOptionsPostId) ?? null
    : null;

  const onClosePostOptions = useCallback(() => {
    setPostOptionsPostId(null);
  }, []);

  useSwipeBackOverride(swipeBackOverrideRef, onClosePostOptions, postOptionsPost !== null);

  if (postOptionsPost) {
    return (
      <PostOptionsPane
        post={postOptionsPost}
        onBack={onClosePostOptions}
        currentUserId={viewerUserId}
        onViewUserProfile={onViewUserProfile}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <div
        ref={feedContainerRef}
        onTouchStart={onFeedTouchStart}
        onTouchMove={onFeedTouchMove}
        onTouchEnd={resetPullGesture}
        onTouchCancel={resetPullGesture}
        onWheel={onFeedWheel}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y"
      >
        {onOpenCreatePost ? (
          <div className="px-3 pt-3 pb-2">
            <button
              type="button"
              onClick={onOpenCreatePost}
              className="create-post-rgb-border flex w-full items-center justify-center gap-2 rounded-2xl py-4 font-semibold shadow-sm"
            >
              <span className="create-post-rgb-text">+ Create Post</span>
            </button>
          </div>
        ) : null}

        <div
          className="w-full overflow-hidden text-xs text-muted"
          style={{
            maxHeight: loadingFeedHeight,
            transition: `max-height ${loadingFeedTransitionMs}ms ease`,
          }}
        >
          <div
            ref={loadingFeedContentRef}
            className="flex w-full flex-col items-center justify-center gap-2 px-3 py-3"
          >
            <Loader animateHeight={false} />
            <span>Loading feed...</span>
          </div>
        </div>

        {!isLoading && posts.length === 0 ? (
          <div className="px-3 py-3 text-xs text-muted">No posts yet.</div>
        ) : null}

        {showTopRefreshIndicator ? (
          <div className="px-3 py-2">
            <div className="flex items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
              <Loader scale={0.7} />
              <p className="text-xs text-muted">Refreshing feed...</p>
            </div>
          </div>
        ) : null}

        {posts.map((post) => (
          <PostSection
            key={post.id}
            post={post}
            currentUserId={viewerUserId}
            onViewUserProfile={onViewUserProfile}
            onOpenPostOptions={setPostOptionsPostId}
            onPostUpdated={onPostUpdated}
          />
        ))}

        {hasMore ? (
          <div
            ref={loadMoreSentinelRef}
            className="flex w-full items-center justify-center px-3 py-6"
            aria-busy={isLoadingMore}
            aria-live="polite"
          >
            <Loader animateHeight={false} />
            <span className="sr-only">{isLoadingMore ? "Loading more posts" : "Scroll to load more posts"}</span>
          </div>
        ) : null}

        {statusMessage ? <p className="px-3 py-2 text-xs text-muted">{statusMessage}</p> : null}
      </div>
    </div>
  );
}
