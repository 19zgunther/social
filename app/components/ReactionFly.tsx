"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { resolveEmojisByUuid } from "@/app/lib/customEmojiCache";
import {
  CustomEmoji,
  customEmojiUuidFromToken,
  EMOJI_FLY_DURATION_MS,
  EMOJI_FLY_EASING,
  EMOJI_FLY_HOLD_MS,
  EMOJI_FLY_SIZE_RATIO,
} from "@/app/lib/customEmojiCanvas";
import { EmojiItem, PostCommentNode } from "@/app/types/interfaces";
const EMOJI_ONLY_COMMENT_REGEX = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\uFE0F|\u200D|\s)+$/u;
const HAS_EMOJI_REGEX = /\p{Extended_Pictographic}/u;

type ReactionFlyState = {
  id: number;
  emoji: string;
  targetKey: string | null;
};

const isEmojiOnlyComment = (value: string): boolean => {
  const trimmed = value.trim();
  return (
    (Boolean(trimmed) && EMOJI_ONLY_COMMENT_REGEX.test(trimmed) && HAS_EMOJI_REGEX.test(trimmed))
    || customEmojiUuidFromToken(trimmed) !== null
  );
};

const getCommentAtPath = (
  comments: Record<string, PostCommentNode> | undefined,
  path: string[],
): PostCommentNode | null => {
  if (!comments || path.length === 0) {
    return null;
  }
  let map = comments;
  for (let index = 0; index < path.length; index += 1) {
    const node = map[path[index]!];
    if (!node) {
      return null;
    }
    if (index === path.length - 1) {
      return node;
    }
    map = node.replies ?? {};
  }
  return null;
};

const getRepliesMapAtPath = (
  comments: Record<string, PostCommentNode> | undefined,
  parentPath: string[],
): Record<string, PostCommentNode> => {
  if (parentPath.length === 0) {
    return comments ?? {};
  }
  return getCommentAtPath(comments, parentPath)?.replies ?? {};
};

export function findNewEmojiReactionKey(
  previousComments: Record<string, PostCommentNode> | undefined,
  nextComments: Record<string, PostCommentNode> | undefined,
  parentPath: string[],
  emoji: string,
  pathSeparator: string,
): string | null {
  const previousReplies = getRepliesMapAtPath(previousComments, parentPath);
  const nextReplies = getRepliesMapAtPath(nextComments, parentPath);
  const trimmedEmoji = emoji.trim();
  for (const [timestamp, comment] of Object.entries(nextReplies)) {
    if (timestamp in previousReplies) {
      continue;
    }
    if (comment.text.trim() === trimmedEmoji && isEmojiOnlyComment(comment.text)) {
      return [...parentPath, timestamp].join(pathSeparator);
    }
  }
  return null;
}

export function RenderReactionEmoji({
  value,
  customEmojiByUuid,
  fillContainer = false,
}: {
  value: string;
  customEmojiByUuid: Record<string, EmojiItem>;
  fillContainer?: boolean;
}) {
  const uuid = customEmojiUuidFromToken(value);
  if (!uuid) {
    return (
      <span className={fillContainer ? "leading-none" : "text-xl leading-none"}>
        {value}
      </span>
    );
  }
  const customEmoji = customEmojiByUuid[uuid];
  if (!customEmoji) {
    return (
      <span className={fillContainer ? "leading-none" : "text-xl leading-none"}>
        ?
      </span>
    );
  }
  if (fillContainer) {
    return (
      <span className="flex h-full w-full items-center justify-center [&_canvas]:!h-full [&_canvas]:!w-full">
        <CustomEmoji customEmoji={customEmoji} enablePeek={false} />
      </span>
    );
  }
  return <CustomEmoji customEmoji={customEmoji} />;
}

function ReactionFlyOverlay({
  emoji,
  customEmojiByUuid,
  targetKey,
  reactionElByKeyRef,
  onComplete,
}: {
  emoji: string;
  customEmojiByUuid: Record<string, EmojiItem>;
  targetKey: string | null;
  reactionElByKeyRef: MutableRefObject<Record<string, HTMLElement | null>>;
  onComplete: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const [viewportMetrics, setViewportMetrics] = useState<{
    flySizePx: number;
    centerX: number;
    centerY: number;
  } | null>(null);

  useEffect(() => {
    setViewportMetrics({
      flySizePx: Math.min(window.innerWidth, window.innerHeight) * EMOJI_FLY_SIZE_RATIO,
      centerX: window.innerWidth / 2,
      centerY: window.innerHeight / 2,
    });
  }, []);

  useLayoutEffect(() => {
    if (!targetKey || !viewportMetrics) {
      return;
    }

    let cancelled = false;
    let animation: Animation | null = null;
    let frameId = 0;
    let holdTimer = 0;
    const { flySizePx } = viewportMetrics;

    const startFlight = () => {
      if (cancelled) {
        return;
      }
      const overlay = overlayRef.current;
      const targetEl = reactionElByKeyRef.current[targetKey];
      if (!overlay || !targetEl) {
        frameId = window.requestAnimationFrame(startFlight);
        return;
      }

      const endRect = targetEl.getBoundingClientRect();
      const endSize = Math.max(endRect.width, endRect.height, 1);
      const startX = window.innerWidth / 2;
      const startY = window.innerHeight / 2;
      const endX = endRect.left + endRect.width / 2;
      const endY = endRect.top + endRect.height / 2;
      const endScale = endSize / Math.max(flySizePx, 1);

      animation = overlay.animate(
        [
          {
            transform: `translate(${startX}px, ${startY}px) translate(-50%, -50%) scale(1)`,
            opacity: 1,
          },
          {
            transform: `translate(${endX}px, ${endY}px) translate(-50%, -50%) scale(${endScale})`,
            opacity: 1,
          },
        ],
        {
          duration: EMOJI_FLY_DURATION_MS,
          easing: EMOJI_FLY_EASING,
          fill: "forwards",
        },
      );

      void animation.finished.then(() => {
        if (!cancelled) {
          onCompleteRef.current();
        }
      }).catch(() => {
        // Animation was cancelled.
      });
    };

    holdTimer = window.setTimeout(startFlight, EMOJI_FLY_HOLD_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(holdTimer);
      window.cancelAnimationFrame(frameId);
      animation?.cancel();
    };
  }, [targetKey, reactionElByKeyRef, viewportMetrics]);

  if (!viewportMetrics) {
    return null;
  }

  return createPortal(
    <div
      ref={overlayRef}
      className="pointer-events-none fixed left-0 top-0 z-[3000] flex items-center justify-center leading-none"
      style={{
        width: viewportMetrics.flySizePx,
        height: viewportMetrics.flySizePx,
        fontSize: viewportMetrics.flySizePx,
        transform: `translate(${viewportMetrics.centerX}px, ${viewportMetrics.centerY}px) translate(-50%, -50%)`,
      }}
      aria-hidden
    >
      <RenderReactionEmoji value={emoji} customEmojiByUuid={customEmojiByUuid} fillContainer />
    </div>,
    document.body,
  );
}

type UseReactionFlyArgs = {
  customEmojiByUuid: Record<string, EmojiItem>;
  setCustomEmojiByUuid: (
    update: (previous: Record<string, EmojiItem>) => Record<string, EmojiItem>,
  ) => void;
};

export function useReactionFly({
  customEmojiByUuid,
  setCustomEmojiByUuid,
}: UseReactionFlyArgs): {
  beginReactionFly: (emoji: string) => number;
  cancelReactionFly: (flyId: number) => void;
  setReactionFlyTarget: (flyId: number, targetKey: string | null) => void;
  bindReactionEl: (reactionKey: string) => (element: HTMLSpanElement | null) => void;
  isFlyingReaction: (reactionKey: string) => boolean;
  reactionFlyOverlay: ReactNode;
} {
  const [reactionFly, setReactionFly] = useState<ReactionFlyState | null>(null);
  const reactionFlyIdRef = useRef(0);
  const reactionElByKeyRef = useRef<Record<string, HTMLElement | null>>({});

  const cancelReactionFly = (flyId: number) => {
    setReactionFly((previous) => (previous?.id === flyId ? null : previous));
  };

  const beginReactionFly = (emoji: string): number => {
    const flyId = reactionFlyIdRef.current + 1;
    reactionFlyIdRef.current = flyId;
    setReactionFly({ id: flyId, emoji, targetKey: null });

    const customUuid = customEmojiUuidFromToken(emoji);
    if (customUuid && !customEmojiByUuid[customUuid]) {
      void resolveEmojisByUuid([customUuid]).then((merged) => {
        setCustomEmojiByUuid((previous) => ({ ...previous, ...merged }));
      }).catch(() => {
        // Ignore; overlay falls back to "?" until resolve succeeds elsewhere.
      });
    }

    return flyId;
  };

  const setReactionFlyTarget = (flyId: number, targetKey: string | null) => {
    if (!targetKey) {
      cancelReactionFly(flyId);
      return;
    }
    setReactionFly((previous) =>
      previous?.id === flyId ? { ...previous, targetKey } : previous,
    );
  };

  const bindReactionEl = (reactionKey: string) => (element: HTMLSpanElement | null) => {
    reactionElByKeyRef.current[reactionKey] = element;
  };

  const isFlyingReaction = (reactionKey: string) => reactionFly?.targetKey === reactionKey;

  const reactionFlyOverlay = reactionFly ? (
    <ReactionFlyOverlay
      key={reactionFly.id}
      emoji={reactionFly.emoji}
      customEmojiByUuid={customEmojiByUuid}
      targetKey={reactionFly.targetKey}
      reactionElByKeyRef={reactionElByKeyRef}
      onComplete={() => {
        cancelReactionFly(reactionFly.id);
      }}
    />
  ) : null;

  return {
    beginReactionFly,
    cancelReactionFly,
    setReactionFlyTarget,
    bindReactionEl,
    isFlyingReaction,
    reactionFlyOverlay,
  };
}
