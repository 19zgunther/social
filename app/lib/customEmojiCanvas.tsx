/** Custom emoji token parsing and base64 pixel decoding → 2D canvas (posts, thread messages, reactions). */

import { useEffect, useState } from "react";
import { EmojiItem } from "../types/interfaces";

export const CUSTOM_EMOJI_TOKEN_REGEX = /^\[\[(?:(?:emoji|ce):)?([a-f0-9-]{36})\]\]$/i;

const CUSTOM_EMOJI_GRID_SIZE = 64;
const CUSTOM_EMOJI_PIXEL_COUNT = CUSTOM_EMOJI_GRID_SIZE * CUSTOM_EMOJI_GRID_SIZE;
const CUSTOM_EMOJI_UPSCALE_FACTOR = 4;
export const CUSTOM_EMOJI_RENDER_SIZE = CUSTOM_EMOJI_GRID_SIZE * CUSTOM_EMOJI_UPSCALE_FACTOR;

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

export const CustomEmoji = ({
  customEmoji,
  onPointerDown,
}: {
  customEmoji: EmojiItem;
  onPointerDown?: () => void;
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <canvas
      width={CUSTOM_EMOJI_RENDER_SIZE}
      height={CUSTOM_EMOJI_RENDER_SIZE}
      ref={(el) => {
        if (!el) {
          return;
        }
        drawCustomEmojiCanvas(el, customEmoji.data_b64);
      }}
      onPointerDown={() => { 
        setIsExpanded(!isExpanded); setTimeout(() => { setIsExpanded(false); }, 4000); 
        onPointerDown?.();
      }}
      className={`h-7 w-7 [image-rendering:pixelated] ${isExpanded ? "h-20 w-20" : ""} transition-all duration-100`}
      title={customEmoji.name}
    />
  )
}