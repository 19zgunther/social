"use client";

import { TouchEvent, WheelEvent, useCallback, useEffect, useRef, useState } from "react";
import { PostSection} from "@/app/components/PostSection";
import { ApiError, FeedPostsListResponse, PostItem, PostData } from "@/app/types/interfaces";
import { useStateCached } from "./useStateCached";
import { LoaderCircle, Plus } from "lucide-react";
const FEED_CACHE_KEY = "feed_cache_v1";
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
}: {
  onViewUserProfile?: (userId: string) => void;
  onOpenCreatePost?: () => void;
}) {
  const [posts, setPosts] = useStateCached<PostItem[]>([], FEED_CACHE_KEY);
  const [viewerUserId, setViewerUserId] = useState<string | null>(null);
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
        if (payload.viewer_user_id) {
          setViewerUserId(payload.viewer_user_id);
        }
        setHasMore(payload.has_more);
        setNextCursorPostId(payload.next_cursor_post_id);

        if (cursorPostId) {
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

  const showTopRefreshIndicator = isRefreshingLatest && didHydrateFromCache && posts.length > 0;

  // For animating loading feed height
  const [loadingFeedHeight, setLoadingFeedHeight] = useState(0);
  useEffect(() => {
    setLoadingFeedHeight(isLoading ? 5 : 0);
  }, [isLoading])
  
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
        {onOpenCreatePost ? (
          <div className="px-3 pt-3 pb-2">
            <button
              type="button"
              onClick={onOpenCreatePost}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-accent-3 bg-secondary-background py-4 text-accent-3 font-semibold shadow-sm transition hover:border-accent-2 hover:text-foreground"
            >
              + Create Post
            </button>
          </div>
        ) : null}

        <div className="text-xs text-accent-2 transition-all duration-400 overflow-hidden w-full" style={{ maxHeight: `${loadingFeedHeight}rem` }}>
          <div className="px-3 py-3 flex items-center text-center justify-center gap-2 w-full">
            Loading feed... <LoaderCircle className="w-4 h-4 inline-block animate-spin" />
          </div>
        </div>

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
          <PostSection
            key={post.id}
            post={post}
            currentUserId={viewerUserId}
            onViewUserProfile={onViewUserProfile}
            onPostUpdated={onPostUpdated}
          />
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
