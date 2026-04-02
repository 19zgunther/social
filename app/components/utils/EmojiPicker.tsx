"use client";

import { useEffect, useMemo, useState } from "react";
import { Smile } from "lucide-react";
import { createPortal } from "react-dom";
import emojiKeywordsByEmoji from "emojilib";
import { DONT_SWIPE_TABS_CLASSNAME } from "./useSwipeBack";
import { EmojiItem, EmojisListResponse } from "@/app/types/interfaces";
const RECENT_EMOJIS_STORAGE_KEY = "emojiPickerRecentUsage";
const RECENT_EMOJIS_STORAGE_BACKUP_KEY = "emojiPickerRecentUsageBackup";
const MAX_RECENT_EMOJIS = 50;
const CUSTOM_EMOJI_GRID_SIZE = 64;
const CUSTOM_EMOJI_PIXEL_COUNT = CUSTOM_EMOJI_GRID_SIZE * CUSTOM_EMOJI_GRID_SIZE;
const CUSTOM_EMOJI_UPSCALE_FACTOR = 4;
const CUSTOM_EMOJI_RENDER_SIZE = CUSTOM_EMOJI_GRID_SIZE * CUSTOM_EMOJI_UPSCALE_FACTOR;
const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const CUSTOM_EMOJI_TRANSPARENT_FLAG = 1 << 9;
const CUSTOM_EMOJI_RGB_MASK = 0b1_1111_1111;

type EmojiUsageEntry = {
  emoji: string;
  count: number;
  lastUsed: number;
};

const isValidEmojiUsageEntry = (value: unknown): value is EmojiUsageEntry => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as EmojiUsageEntry;
  return (
    typeof candidate.emoji === "string" &&
    candidate.emoji.length > 0 &&
    Number.isFinite(candidate.count) &&
    candidate.count > 0 &&
    Number.isFinite(candidate.lastUsed) &&
    candidate.lastUsed > 0
  );
};

const sortAndTrimUsage = (usage: EmojiUsageEntry[]): EmojiUsageEntry[] =>
  usage
    .sort((first, second) => {
      if (second.count !== first.count) {
        return second.count - first.count;
      }
      return second.lastUsed - first.lastUsed;
    })
    .slice(0, MAX_RECENT_EMOJIS);

const normalizeStoredUsage = (rawValue: unknown): EmojiUsageEntry[] => {
  if (!Array.isArray(rawValue)) {
    return [];
  }

  const now = Date.now();
  const normalizedByEmoji = new Map<string, EmojiUsageEntry>();

  rawValue.forEach((entry, index) => {
    if (typeof entry === "string" && entry.length > 0) {
      const existing = normalizedByEmoji.get(entry);
      const candidate: EmojiUsageEntry = {
        emoji: entry,
        count: (existing?.count ?? 0) + 1,
        lastUsed: Math.max(existing?.lastUsed ?? 0, now - index),
      };
      normalizedByEmoji.set(entry, candidate);
      return;
    }

    if (isValidEmojiUsageEntry(entry)) {
      const existing = normalizedByEmoji.get(entry.emoji);
      const candidate: EmojiUsageEntry = {
        emoji: entry.emoji,
        count: Math.max(entry.count, existing?.count ?? 0),
        lastUsed: Math.max(entry.lastUsed, existing?.lastUsed ?? 0),
      };
      normalizedByEmoji.set(entry.emoji, candidate);
    }
  });

  return sortAndTrimUsage(Array.from(normalizedByEmoji.values()));
};

const loadStoredUsage = (): EmojiUsageEntry[] => {
  const primaryRaw = window.localStorage.getItem(RECENT_EMOJIS_STORAGE_KEY);
  if (primaryRaw) {
    try {
      const parsedPrimary = JSON.parse(primaryRaw) as unknown;
      const normalizedPrimary = normalizeStoredUsage(parsedPrimary);
      if (normalizedPrimary.length > 0) {
        return normalizedPrimary;
      }
    } catch {
      // Fall through to backup key recovery.
    }
  }

  const backupRaw = window.localStorage.getItem(RECENT_EMOJIS_STORAGE_BACKUP_KEY);
  if (!backupRaw) {
    return [];
  }

  try {
    const parsedBackup = JSON.parse(backupRaw) as unknown;
    const normalizedBackup = normalizeStoredUsage(parsedBackup);
    if (normalizedBackup.length > 0) {
      window.localStorage.setItem(RECENT_EMOJIS_STORAGE_KEY, JSON.stringify(normalizedBackup));
      return normalizedBackup;
    }
    return [];
  } catch {
    return [];
  }
};

const persistUsage = (usage: EmojiUsageEntry[]) => {
  const serializedUsage = JSON.stringify(usage);
  try {
    window.localStorage.setItem(RECENT_EMOJIS_STORAGE_KEY, serializedUsage);
  } catch {
    // Keep going; backup key is attempted below.
  }
  try {
    window.localStorage.setItem(RECENT_EMOJIS_STORAGE_BACKUP_KEY, serializedUsage);
  } catch {
    // If both fail we still keep in-memory state.
  }
};

const updateUsageWithSelection = (usage: EmojiUsageEntry[], emoji: string, timestamp: number): EmojiUsageEntry[] => {
  const usageByEmoji = new Map<string, EmojiUsageEntry>(usage.map((entry) => [entry.emoji, { ...entry }]));
  const currentEntry = usageByEmoji.get(emoji);
  usageByEmoji.set(emoji, {
    emoji,
    count: (currentEntry?.count ?? 0) + 1,
    lastUsed: timestamp,
  });

  return sortAndTrimUsage(Array.from(usageByEmoji.values()));
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

const drawCustomEmojiPreview = (canvas: HTMLCanvasElement, dataB64: string) => {
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

type EmojiPickerProps = {
  onSelectEmoji: (emoji: string) => void;
  className?: string;
  buttonClassName?: string;
};

const customEmojiToken = (emojiUuid: string): string => `[[emoji:${emojiUuid}]]`;

export default function EmojiPicker({
  onSelectEmoji,
  className,
  buttonClassName,
}: EmojiPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [recentEmojiUsage, setRecentEmojiUsage] = useState<EmojiUsageEntry[]>([]);
  const [customEmojis, setCustomEmojis] = useState<EmojiItem[]>([]);
  const allEmojiOptions = useMemo(() => Object.keys(emojiKeywordsByEmoji), []);
  
  const emojiSearchKeywordsByEmoji = useMemo(() => {
    const keywordsByEmoji = new Map<string, string[]>();

    allEmojiOptions.forEach((emoji) => {
      const keywords = emojiKeywordsByEmoji[emoji];
      if (!keywords || keywords.length === 0) {
        return;
      }

      keywordsByEmoji.set(
        emoji,
        keywords.flatMap((keyword) => [keyword.toLowerCase(), keyword.toLowerCase().replace(/_/g, " ")]),
      );
    });

    return keywordsByEmoji;
  }, [allEmojiOptions]);
  const recentEmojiOptions = useMemo(
    () => recentEmojiUsage.slice(0, MAX_RECENT_EMOJIS).map((entry) => entry.emoji),
    [recentEmojiUsage],
  );
  const filteredEmojiOptions = useMemo(() => {
    const trimmedSearchTerm = searchTerm.trim();
    if (!trimmedSearchTerm) {
      return allEmojiOptions;
    }

    const normalizedSearchTerm = trimmedSearchTerm.toLowerCase();
    return allEmojiOptions.filter((emoji) => {
      if (emoji.includes(trimmedSearchTerm)) {
        return true;
      }

      const emojiKeywords = emojiSearchKeywordsByEmoji.get(emoji);
      if (!emojiKeywords) {
        return false;
      }

      return emojiKeywords.some((keyword) => keyword.includes(normalizedSearchTerm));
    });
  }, [allEmojiOptions, emojiSearchKeywordsByEmoji, searchTerm]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted) {
      return;
    }

    setRecentEmojiUsage(loadStoredUsage());

    const onStorageChange = (event: StorageEvent) => {
      if (
        event.key !== RECENT_EMOJIS_STORAGE_KEY &&
        event.key !== RECENT_EMOJIS_STORAGE_BACKUP_KEY
      ) {
        return;
      }
      setRecentEmojiUsage(loadStoredUsage());
    };

    window.addEventListener("storage", onStorageChange);
    return () => {
      window.removeEventListener("storage", onStorageChange);
    };
  }, [isMounted]);

  useEffect(() => {
    if (!isMounted || !isOpen) {
      return;
    }
    let cancelled = false;
    const loadCustomEmojis = async () => {
      try {
        const response = await fetch("/api/emojis-list", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as EmojisListResponse;
        if (!cancelled) {
          setCustomEmojis(payload.emojis);
        }
      } catch {
        // Ignore custom emoji loading failures; default emoji picker still works.
      }
    };
    void loadCustomEmojis();
    return () => {
      cancelled = true;
    };
  }, [isMounted, isOpen]);

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

  const handleSelectEmoji = (emoji: string) => {
    try {
      onSelectEmoji(emoji);
    } finally {
      const now = Date.now();
      const latestStoredUsage = loadStoredUsage();
      const updatedUsage = updateUsageWithSelection(latestStoredUsage, emoji, now);
      persistUsage(updatedUsage);
      setRecentEmojiUsage(updatedUsage);
      setIsOpen(false);
    }
  };

  return (
    <div className={DONT_SWIPE_TABS_CLASSNAME + " " + (className ?? "")}>
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
            className={`${DONT_SWIPE_TABS_CLASSNAME} fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 px-4`}
            onClick={() => setIsOpen(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Emoji picker"
              className="w-full max-w-sm overflow-hidden rounded-xl border border-accent-1 bg-secondary-background p-3 shadow-xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-accent-2">Choose an emoji</p>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="rounded-md border border-accent-1 px-2 py-1 text-sm text-accent-2 hover:text-foreground"
                >
                  Close
                </button>
              </div>
              <div className="mb-2">
                <label htmlFor="emoji-search" className="mb-1 block text-[11px] font-semibold text-accent-2">
                  Search
                </label>
                <input
                  id="emoji-search"
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Type emoji or keyword (heart, laugh, fire)..."
                  className="w-full rounded-md border border-accent-1 bg-background px-2 py-1 text-sm text-foreground outline-none placeholder:text-accent-2/70 focus:border-accent-2"
                />
              </div>
              <p className="mb-1 text-[11px] font-semibold text-accent-2">Recent</p>
              <div className="mb-3 overflow-x-auto overflow-y-hidden pb-1">
                <div className="grid grid-flow-col grid-rows-1 gap-1">
                  {recentEmojiOptions.map((emoji, index) => (
                    <button
                      key={`recent-${emoji}-${index}`}
                      type="button"
                      onClick={() => handleSelectEmoji(emoji)}
                      className="h-8 w-8 rounded-md px-1 py-1 text-base transition hover:bg-accent-1/40"
                      aria-label={`Insert ${emoji}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
              {customEmojis.length > 0 ? (
                <>
                  <p className="mb-1 text-[11px] font-semibold text-accent-2">Your custom emojis</p>
                  <div className="mb-3 overflow-x-auto overflow-y-hidden pb-1">
                    <div className="grid h-[6.5rem] grid-flow-col grid-rows-3 gap-1">
                      {customEmojis.map((emoji) => (
                        <button
                          key={emoji.uuid}
                          type="button"
                          onClick={() => handleSelectEmoji(customEmojiToken(emoji.uuid))}
                          className="flex h-8 w-8 items-center justify-center rounded-md px-1 py-1 transition hover:bg-accent-1/40"
                          aria-label={`Insert custom emoji ${emoji.name}`}
                          title={emoji.name}
                        >
                          <canvas
                            width={CUSTOM_EMOJI_RENDER_SIZE}
                            height={CUSTOM_EMOJI_RENDER_SIZE}
                            ref={(el) => {
                              if (!el) {
                                return;
                              }
                              drawCustomEmojiPreview(el, emoji.data_b64);
                            }}
                            className="h-6 w-6 [image-rendering:pixelated]"
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}
              <p className="mb-1 text-[11px] font-semibold text-accent-2">All emojis</p>
              <div className="overflow-x-auto overflow-y-hidden pb-1">
                <div className="grid h-[8.75rem] grid-flow-col grid-rows-4 gap-1">
                  {filteredEmojiOptions.map((emoji, index) => (
                    <button
                      key={`${emoji}-${index}`}
                      type="button"
                      onClick={() => handleSelectEmoji(emoji)}
                      className="h-8 w-8 rounded-md px-1 py-1 text-base transition hover:bg-accent-1/40"
                      aria-label={`Insert ${emoji}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )
        : null}
    </div>
  );
}
