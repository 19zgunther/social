"use client";

import { useEffect, useMemo, useState } from "react";
import { Smile } from "lucide-react";
import { createPortal } from "react-dom";

const DEFAULT_EMOJIS = [
  "😀",
  "😂",
  "😍",
  "🥳",
  "🔥",
  "👏",
  "❤️",
  "👍",
  "🙏",
  "🤔",
  "😎",
  "🎉",
];

type EmojiPickerProps = {
  onSelectEmoji: (emoji: string) => void;
  className?: string;
  buttonClassName?: string;
};

export default function EmojiPicker({
  onSelectEmoji,
  className,
  buttonClassName,
}: EmojiPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const emojiOptions = useMemo(() => DEFAULT_EMOJIS, []);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  return (
    <div className={className ?? ""}>
      <button
        type="button"
        onClick={() => setIsOpen((previous) => !previous)}
        className={`rounded-lg border border-accent-1 px-2 py-1 text-accent-2 transition hover:text-foreground ${buttonClassName ?? ""}`}
        aria-label="Add emoji"
      >
        <Smile className="h-4 w-4" />
      </button>

      {isMounted && isOpen
        ? createPortal(
          <div
            className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 px-4"
            onClick={() => setIsOpen(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Emoji picker"
              className="w-full max-w-xs rounded-xl border border-accent-1 bg-secondary-background p-3 shadow-xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold text-accent-2">Choose an emoji</p>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="rounded-md border border-accent-1 px-2 py-1 text-[11px] text-accent-2 hover:text-foreground"
                >
                  Close
                </button>
              </div>
              <div className="grid grid-cols-6 gap-1">
                {emojiOptions.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => {
                      onSelectEmoji(emoji);
                      setIsOpen(false);
                    }}
                    className="rounded-md px-1 py-1 text-base transition hover:bg-accent-1/40"
                    aria-label={`Insert ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )
        : null}
    </div>
  );
}
