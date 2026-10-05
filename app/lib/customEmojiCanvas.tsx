/** Custom emoji token parsing and base64 pixel decoding → 2D canvas (posts, thread messages, reactions). */

"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { EmojiItem } from "../types/interfaces";

export const CUSTOM_EMOJI_TOKEN_REGEX = /^\[\[(?:(?:emoji|ce):)?([a-f0-9-]{36})\]\]$/i;

const CUSTOM_EMOJI_GRID_SIZE = 64;
const CUSTOM_EMOJI_PIXEL_COUNT = CUSTOM_EMOJI_GRID_SIZE * CUSTOM_EMOJI_GRID_SIZE;
const CUSTOM_EMOJI_UPSCALE_FACTOR = 4;
export const CUSTOM_EMOJI_RENDER_SIZE = CUSTOM_EMOJI_GRID_SIZE * CUSTOM_EMOJI_UPSCALE_FACTOR;

export const EMOJI_FLY_SIZE_RATIO = 0.2;
export const EMOJI_FLY_DURATION_MS = 560;
export const EMOJI_FLY_HOLD_MS = 140;
export const EMOJI_PEEK_HOLD_MS = 1600;
export const EMOJI_FLY_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const CUSTOM_EMOJI_TRANSPARENT_FLAG = 1 << 9;
const CUSTOM_EMOJI_RGB_MASK = 0b1_1111_1111;

export const customEmojiUuidFromToken = (value: string): string | null => {
  const match = value.trim().match(CUSTOM_EMOJI_TOKEN_REGEX);
  return match?.[1] ?? null;
};

const decodeCustomEmojiDataB64 = (dataB64: string): Uint16Array => {
  const pixels = new Uint16Array(CUSTOM_EMOJI_PIXEL_COUNT);
  if (dataB64.length !== CUSTOM_EMOJI_PIXEL_COUNT * 2) {
    return pixels;
  }
  for (let i = 0; i < CUSTOM_EMOJI_PIXEL_COUNT; i += 1) {
    const first = B64_ALPHABET.indexOf(dataB64[i * 2]);
    const second = B64_ALPHABET.indexOf(dataB64[i * 2 + 1]);
    if (first < 0 || second < 0) {
      continue;
    }
    const r = (first >> 3) & 0b111;
    const g = first & 0b111;
    const b = (second >> 3) & 0b111;
    const rgb = (r << 6) | (g << 3) | b;
    const metadata = second & 0b111;
    const isTransparent = (metadata & 0b001) === 0b001 || (metadata === 0 && rgb === 0);
    pixels[i] = rgb | (isTransparent ? CUSTOM_EMOJI_TRANSPARENT_FLAG : 0);
  }
  return pixels;
};

export const drawCustomEmojiCanvas = (canvas: HTMLCanvasElement, dataB64: string) => {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  canvas.width = CUSTOM_EMOJI_RENDER_SIZE;
  canvas.height = CUSTOM_EMOJI_RENDER_SIZE;
  const pixels = decodeCustomEmojiDataB64(dataB64);
  const imageData = new ImageData(CUSTOM_EMOJI_GRID_SIZE, CUSTOM_EMOJI_GRID_SIZE);
  for (let i = 0; i < CUSTOM_EMOJI_PIXEL_COUNT; i += 1) {
    const packed = pixels[i] ?? 0;
    const rgb = packed & CUSTOM_EMOJI_RGB_MASK;
    imageData.data[i * 4] = Math.round(((rgb >> 6) & 0b111) * (255 / 7));
    imageData.data[i * 4 + 1] = Math.round(((rgb >> 3) & 0b111) * (255 / 7));
    imageData.data[i * 4 + 2] = Math.round((rgb & 0b111) * (255 / 7));
    imageData.data[i * 4 + 3] = (packed & CUSTOM_EMOJI_TRANSPARENT_FLAG) === CUSTOM_EMOJI_TRANSPARENT_FLAG ? 0 : 255;
  }
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = CUSTOM_EMOJI_GRID_SIZE;
  sourceCanvas.height = CUSTOM_EMOJI_GRID_SIZE;
  const sourceCtx = sourceCanvas.getContext("2d");
  if (!sourceCtx) {
    return;
  }
  sourceCtx.putImageData(imageData, 0, 0);
  ctx.clearRect(0, 0, CUSTOM_EMOJI_RENDER_SIZE, CUSTOM_EMOJI_RENDER_SIZE);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(sourceCanvas, 0, 0, CUSTOM_EMOJI_RENDER_SIZE, CUSTOM_EMOJI_RENDER_SIZE);
};

type PeekSource = {
  x: number;
  y: number;
  size: number;
};

function CustomEmojiPeekOverlay({
  customEmoji,
  source,
  sourceElRef,
  onComplete,
}: {
  customEmoji: EmojiItem;
  source: PeekSource;
  sourceElRef: RefObject<HTMLCanvasElement | null>;
  onComplete: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const flySizePx = Math.min(window.innerWidth, window.innerHeight) * EMOJI_FLY_SIZE_RATIO;
  const centerX = window.innerWidth / 2;
  const centerY = window.innerHeight / 2;
  const startScale = source.size / Math.max(flySizePx, 1);

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) {
      return;
    }

    let cancelled = false;
    let expandAnimation: Animation | null = null;
    let shrinkAnimation: Animation | null = null;
    let holdTimer = 0;

    const shrinkBack = () => {
      if (cancelled) {
        return;
      }
      const sourceEl = sourceElRef.current;
      const endRect = sourceEl?.getBoundingClientRect();
      const endX = endRect ? endRect.left + endRect.width / 2 : source.x;
      const endY = endRect ? endRect.top + endRect.height / 2 : source.y;
      const endSize = endRect ? Math.max(endRect.width, endRect.height, 1) : source.size;
      const endScale = endSize / Math.max(flySizePx, 1);

      shrinkAnimation = overlay.animate(
        [
          {
            transform: `translate(${centerX}px, ${centerY}px) translate(-50%, -50%) scale(1)`,
          },
          {
            transform: `translate(${endX}px, ${endY}px) translate(-50%, -50%) scale(${endScale})`,
          },
        ],
        {
          duration: EMOJI_FLY_DURATION_MS,
          easing: EMOJI_FLY_EASING,
          fill: "forwards",
        },
      );

      void shrinkAnimation.finished.then(() => {
        if (!cancelled) {
          onCompleteRef.current();
        }
      }).catch(() => {
        // Animation was cancelled.
      });
    };

    expandAnimation = overlay.animate(
      [
        {
          transform: `translate(${source.x}px, ${source.y}px) translate(-50%, -50%) scale(${startScale})`,
        },
        {
          transform: `translate(${centerX}px, ${centerY}px) translate(-50%, -50%) scale(1)`,
        },
      ],
      {
        duration: EMOJI_FLY_DURATION_MS,
        easing: EMOJI_FLY_EASING,
        fill: "forwards",
      },
    );

    void expandAnimation.finished.then(() => {
      if (cancelled) {
        return;
      }
      holdTimer = window.setTimeout(shrinkBack, EMOJI_PEEK_HOLD_MS);
    }).catch(() => {
      // Animation was cancelled.
    });

    return () => {
      cancelled = true;
      window.clearTimeout(holdTimer);
      expandAnimation?.cancel();
      shrinkAnimation?.cancel();
    };
  }, [centerX, centerY, flySizePx, source.x, source.y, source.size, sourceElRef, startScale]);

  return createPortal(
    <div
      ref={overlayRef}
      className="pointer-events-none fixed left-0 top-0 z-[3000] flex items-center justify-center"
      style={{
        width: flySizePx,
        height: flySizePx,
        transform: `translate(${source.x}px, ${source.y}px) translate(-50%, -50%) scale(${startScale})`,
      }}
      aria-hidden
    >
      <canvas
        width={CUSTOM_EMOJI_RENDER_SIZE}
        height={CUSTOM_EMOJI_RENDER_SIZE}
        ref={(el) => {
          if (el) {
            drawCustomEmojiCanvas(el, customEmoji.data_b64);
          }
        }}
        className="h-full w-full rounded-md [image-rendering:pixelated]"
        title={customEmoji.name}
      />
    </div>,
    document.body,
  );
}

export const CustomEmoji = ({
  customEmoji,
  onPointerDown,
  enablePeek = true,
}: {
  customEmoji: EmojiItem;
  onPointerDown?: () => void;
  enablePeek?: boolean;
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [peekSource, setPeekSource] = useState<PeekSource | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const handlePointerDown = () => {
    onPointerDown?.();
    if (!enablePeek || peekSource) {
      return;
    }
    const el = canvasRef.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    setPeekSource({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      size: Math.max(rect.width, rect.height, 1),
    });
  };

  return (
    <>
      <canvas
        width={CUSTOM_EMOJI_RENDER_SIZE}
        height={CUSTOM_EMOJI_RENDER_SIZE}
        ref={(el) => {
          canvasRef.current = el;
          if (el) {
            drawCustomEmojiCanvas(el, customEmoji.data_b64);
          }
        }}
        onPointerDown={handlePointerDown}
        className={`h-7 w-7 rounded-md [image-rendering:pixelated] ${peekSource ? "opacity-0" : ""}`}
        title={customEmoji.name}
      />
      {isMounted && peekSource ? (
        <CustomEmojiPeekOverlay
          customEmoji={customEmoji}
          source={peekSource}
          sourceElRef={canvasRef}
          onComplete={() => {
            setPeekSource(null);
          }}
        />
      ) : null}
    </>
  );
};
