"use client";

import type { CSSProperties } from "react";
import CachedImage from "@/app/components/utils/CachedImage";
import { linkifyHttpsText } from "@/app/components/utils/linkifyHttpsText";
import {
  CUSTOM_EMOJI_RENDER_SIZE,
  customEmojiUuidFromToken,
  drawCustomEmojiCanvas,
} from "@/app/lib/customEmojiCanvas";
import type { EmojiItem, ImageOverlayData, ThreadMessage } from "@/app/types/interfaces";

export type ThreadMessageBubbleImageInteraction = "chat" | "options";

type ThreadMessageBubbleContentProps = {
  message: ThreadMessage;
  currentUserId: string;
  customEmojiByUuid: Record<string, EmojiItem>;
  messageImageOverlay: ImageOverlayData | null;
  imageInteraction: ThreadMessageBubbleImageInteraction;
  onOpenImageViewer: () => void;
  onImageLoaded?: () => void;
};

export function ThreadMessageBubbleContent({
  message,
  currentUserId,
  customEmojiByUuid,
  messageImageOverlay,
  imageInteraction,
  onOpenImageViewer,
  onImageLoaded,
}: ThreadMessageBubbleContentProps) {
  const isOwnMessage = message.created_by === currentUserId;
  const hasText = message.text.trim().length > 0;
  const hasImage = Boolean(message.image_url);
  const isImageOnly = hasImage && !hasText;
  const customEmojiUuid = customEmojiUuidFromToken(message.text);
  const customEmoji = customEmojiUuid ? customEmojiByUuid[customEmojiUuid] : undefined;

  return (
    <>
      {!isImageOnly ? (
        <>
          <p className="text-xs opacity-60 [-webkit-touch-callout:none]">
            {isOwnMessage ? "You" : message.username}
          </p>
          {customEmoji ? (
            <canvas
              width={CUSTOM_EMOJI_RENDER_SIZE}
              height={CUSTOM_EMOJI_RENDER_SIZE}
              ref={(el) => { 
                if (!el) { return; }
                drawCustomEmojiCanvas(el, customEmoji.data_b64);
              }}
              className="h-8 w-8 [image-rendering:pixelated]"
              title={customEmoji.name}
            />
          ) : (
            <p className="break-words whitespace-pre-wrap [-webkit-touch-callout:none]">{linkifyHttpsText(message.text)}</p>
          )}
        </>
      ) : null}
      {isImageOnly ? (
        <p className="mb-1 px-1 text-xs opacity-60 [-webkit-touch-callout:none]">
          {isOwnMessage ? "You" : message.username}
        </p>
      ) : null}
      {message.image_url ? (
        <div className={`relative ${!isImageOnly ? "mt-1" : ""}`}>
          <button
            type="button"
            className="block w-full cursor-zoom-in rounded-xl border-0 bg-transparent p-0"
            onClick={(event) => {
              if (imageInteraction === "chat") { event.stopPropagation(); }
              onOpenImageViewer();
            }}
            onContextMenu={(event) => { 
              if (imageInteraction === "chat") { event.preventDefault(); }
            }}
          >
            <CachedImage
              signedUrl={message.image_url}
              imageId={message.image_id}
              alt="Thread message attachment"
              className="max-h-[100vh] w-full rounded-xl object-cover"
              loading="lazy"
              {...(onImageLoaded ? { onLoad: onImageLoaded } : {})}
            />
          </button>
          {messageImageOverlay ? (
            <div
              className="pointer-events-none absolute left-0 right-0 -translate-y-1/2 bg-black/45 px-3 py-2 text-center text-sm font-semibold text-white"
              style={{ top: `${messageImageOverlay.y_ratio * 100}%` }}
            >
              {messageImageOverlay.text}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

export function threadMessageBubbleShellClassName(
  isOwnMessage: boolean,
  isImageOnly: boolean,
  depth: number,
  touchMode: "chat" | "static",
): string {
  const base =
    touchMode === "chat"
      ? "relative max-w-[85%] touch-pan-y select-none [-webkit-touch-callout:none] text-sm"
      : "relative max-w-[85%] select-none text-sm";
  const shape = isImageOnly
    ? `${isOwnMessage ? "ml-auto" : ""}`
    : `rounded-2xl px-3 py-1 shadow-sm ${isOwnMessage
      ? "ml-auto rounded-br-sm bg-accent-3 text-primary-background"
      : "rounded-bl-sm bg-secondary-background text-foreground"
    }`;
  const thread = depth > 0 ? "ml-5 border-l border-accent-1/60" : "";
  return `${base} ${shape} ${thread}`;
}

export function threadMessageBubbleShellStyle(depth: number): CSSProperties | undefined {
  return depth > 0 ? { width: "calc(85% - 1.25rem)" } : undefined;
}
