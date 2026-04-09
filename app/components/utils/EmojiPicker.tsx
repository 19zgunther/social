"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Pencil, Smile, X } from "lucide-react";
import { createPortal } from "react-dom";
import emojiKeywordsByEmoji from "emojilib";
import { DONT_SWIPE_TABS_CLASSNAME } from "./useSwipeBack";
import { loadAllCustomEmojis } from "@/app/lib/customEmojiCache";
import { EmojiItem } from "@/app/types/interfaces";
import { CustomEmoji } from "@/app/lib/customEmojiCanvas";
import EmojiEditorTab from "@/app/components/EmojiEditorTab";
const RECENT_EMOJIS_STORAGE_KEY = "emojiPickerRecentUsage";
const RECENT_EMOJIS_STORAGE_BACKUP_KEY = "emojiPickerRecentUsageBackup";
const MAX_RECENT_EMOJIS = 50;
const CUSTOM_EMOJI_TOKEN_REGEX = /^\[\[(?:(?:emoji|ce):)?([a-f0-9-]{36})\]\]$/i;

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

const customEmojiUuidFromToken = (value: string): string | null => {
  const match = value.trim().match(CUSTOM_EMOJI_TOKEN_REGEX);
  return match?.[1] ?? null;
};

const unicodeEmojiMatchesPickerSearch = (
  emoji: string,
  trimmedSearchTerm: string,
  normalizedSearchTerm: string,
  emojiSearchKeywordsByEmoji: Map<string, string[]>,
): boolean => {
  if (emoji.includes(trimmedSearchTerm)) {
    return true;
  }
  const emojiKeywords = emojiSearchKeywordsByEmoji.get(emoji);
  if (!emojiKeywords) {
    return false;
  }
  return emojiKeywords.some((keyword) => keyword.includes(normalizedSearchTerm));
};

type EmojiPickerProps = {
  onSelectEmoji: (emoji: string) => void;
  className?: string;
  buttonClassName?: string;
  buttonSmileIconClassName?: string;
  /** Fires when the full-screen emoji picker opens or closes (for host UI like overlays). */
  onOpenChange?: (open: boolean) => void;
};

const customEmojiToken = (emojiUuid: string): string => `[[emoji:${emojiUuid}]]`;

export default function EmojiPicker({
  onSelectEmoji,
  className,
  buttonClassName,
  buttonSmileIconClassName,
  onOpenChange,
}: EmojiPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showEmojiEditor, setShowEmojiEditor] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [recentEmojiUsage, setRecentEmojiUsage] = useState<EmojiUsageEntry[]>([]);
  const [customEmojis, setCustomEmojis] = useState<EmojiItem[]>([]);
  const customEmojiByUuid = useMemo(
    () => Object.fromEntries(customEmojis.map((emoji) => [emoji.uuid, emoji])),
    [customEmojis],
  );
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
  const trimmedSearchTerm = searchTerm.trim();
  const normalizedSearchTerm = trimmedSearchTerm.toLowerCase();

  const filteredEmojiOptions = useMemo(() => {
    if (!trimmedSearchTerm) {
      return allEmojiOptions;
    }

    return allEmojiOptions.filter((emoji) =>
      unicodeEmojiMatchesPickerSearch(
        emoji,
        trimmedSearchTerm,
        normalizedSearchTerm,
        emojiSearchKeywordsByEmoji,
      ),
    );
  }, [allEmojiOptions, emojiSearchKeywordsByEmoji, trimmedSearchTerm, normalizedSearchTerm]);

  const filteredCustomEmojis = useMemo(() => {
    if (!trimmedSearchTerm) {
      return customEmojis;
    }
    return customEmojis.filter((emoji) => emoji.name.toLowerCase().includes(normalizedSearchTerm));
  }, [customEmojis, trimmedSearchTerm, normalizedSearchTerm]);

  const filteredRecentEmojiOptions = useMemo(() => {
    if (!trimmedSearchTerm) {
      return recentEmojiOptions;
    }
    return recentEmojiOptions.filter((emoji) => {
      const customUuid = customEmojiUuidFromToken(emoji);
      if (customUuid) {
        const custom = customEmojiByUuid[customUuid];
        return custom ? custom.name.toLowerCase().includes(normalizedSearchTerm) : false;
      }
      return unicodeEmojiMatchesPickerSearch(
        emoji,
        trimmedSearchTerm,
        normalizedSearchTerm,
        emojiSearchKeywordsByEmoji,
      );
    });
  }, [
    recentEmojiOptions,
    trimmedSearchTerm,
    normalizedSearchTerm,
    customEmojiByUuid,
    emojiSearchKeywordsByEmoji,
  ]);

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

  const refreshCustomEmojis = useCallback(async () => {
    try {
      const emojis = await loadAllCustomEmojis();
      setCustomEmojis(emojis);
    } catch {
      // Ignore custom emoji loading failures; default emoji picker still works.
    }
  }, []);

  useEffect(() => {
    if (!isMounted || !isOpen) {
      return;
    }
    let cancelled = false;
    const loadCustomEmojis = async () => {
      try {
        const emojis = await loadAllCustomEmojis();
        if (!cancelled) {
          setCustomEmojis(emojis);
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
      setShowEmojiEditor(false);
    }
  }, [isOpen]);

  useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (showEmojiEditor) {
        setShowEmojiEditor(false);
      } else {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, showEmojiEditor]);

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

  const emojiTileBase =
    "rounded-xl transition-[background-color,box-shadow,transform] duration-200 hover:bg-white/[0.08] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] active:scale-95";

  return (
    <div className={DONT_SWIPE_TABS_CLASSNAME + " " + (className ?? "")}>
      <button
        type="button"
        onClick={() => setIsOpen((previous) => !previous)}
        className={`rounded-lg border border-accent-1 px-2 py-1 text-accent-2 transition hover:text-foreground ${buttonClassName ?? ""}`}
        aria-label="Add emoji"
      >
        <Smile className={`h-4 w-4 ${buttonSmileIconClassName ?? ""}`} />
      </button>

      {isMounted && isOpen
        ? createPortal(
          <div
            className={`${DONT_SWIPE_TABS_CLASSNAME} fixed inset-0 z-[2000] flex items-center justify-center px-4`}
          >
            <div
              className="absolute inset-0 bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,rgba(10,132,255,0.22),transparent_55%),radial-gradient(ellipse_80%_60%_at_100%_100%,rgba(142,156,176,0.12),transparent_50%)] bg-black/45 backdrop-blur-md"
              onClick={() => setIsOpen(false)}
              aria-hidden="true"
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label={showEmojiEditor ? "Custom emoji editor" : "Emoji picker"}
              className={`relative isolate w-full ${showEmojiEditor ? "max-w-md" : "max-w-sm"}`}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="pointer-events-none absolute -inset-px rounded-[1.6rem] bg-gradient-to-br from-white/25 via-white/[0.07] to-white/[0.02] opacity-90 blur-[1px]" />
              <div
                className="relative overflow-hidden rounded-[1.55rem] border border-white/[0.14] bg-gradient-to-b from-white/[0.11] via-secondary-background/35 to-secondary-background/55 p-4 shadow-[0_28px_90px_-20px_rgba(0,0,0,0.75),inset_0_1px_0_0_rgba(255,255,255,0.22),inset_0_-1px_0_0_rgba(255,255,255,0.06)] backdrop-blur-2xl backdrop-saturate-[1.35]"
              >
                <div className="pointer-events-none absolute -left-1/4 -top-1/3 h-[85%] w-[85%] rounded-full bg-gradient-to-br from-white/30 via-white/[0.06] to-transparent opacity-70 blur-3xl" />
                <div className="pointer-events-none absolute -bottom-12 -right-8 h-48 w-48 rounded-full bg-accent-3/20 blur-3xl" />
                <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/45 to-transparent" />
                <div className="relative z-[1] max-h-[min(85vh,720px)] overflow-y-auto overscroll-contain pr-0.5">
                  {showEmojiEditor ? (
                    <>
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => setShowEmojiEditor(false)}
                          className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.12] bg-white/[0.05] px-3 py-1.5 text-xs font-medium text-accent-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-md transition hover:border-white/20 hover:bg-white/[0.1] hover:text-foreground"
                        >
                          <ArrowLeft className="h-4 w-4" />
                          Back to picker
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsOpen(false)}
                          className="rounded-full border border-white/[0.12] bg-white/[0.05] p-1.5 text-accent-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-md transition hover:border-white/20 hover:bg-white/[0.1] hover:text-foreground"
                          aria-label="Close emoji picker"
                        >
                          <X className="h-5 w-5" />
                        </button>
                      </div>
                      <EmojiEditorTab isActive onSaved={refreshCustomEmojis} />
                    </>
                  ) : (
                    <>
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold tracking-tight text-foreground/90 drop-shadow-sm">
                          Choose an emoji
                        </p>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setShowEmojiEditor(true)}
                            className="rounded-full border border-white/[0.12] bg-white/[0.05] p-1.5 text-accent-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-md transition hover:border-white/20 hover:bg-white/[0.1] hover:text-foreground"
                            aria-label="Create or edit custom emoji"
                            title="Create or edit custom emoji"
                          >
                            <Pencil className="h-5 w-5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsOpen(false)}
                            className="rounded-full border border-white/[0.12] bg-white/[0.05] p-1.5 text-accent-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-md transition hover:border-white/20 hover:bg-white/[0.1] hover:text-foreground"
                            aria-label="Close emoji picker"
                          >
                            <X className="h-5 w-5" />
                          </button>
                        </div>
                      </div>
                      <div className="mb-3">
                        <label htmlFor="emoji-search" className="mb-1.5 block text-[11px] font-semibold text-foreground/55">
                          Search
                        </label>
                        <input
                          id="emoji-search"
                          type="text"
                          value={searchTerm}
                          onChange={(event) => setSearchTerm(event.target.value)}
                          placeholder="Emoji, keyword, or your custom emoji name..."
                          className="w-full rounded-xl border border-white/[0.1] bg-black/25 px-3 py-2 text-sm text-foreground shadow-[inset_0_2px_8px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.08)] outline-none backdrop-blur-md placeholder:text-accent-2/55 focus:border-accent-3/40 focus:ring-2 focus:ring-accent-3/25"
                        />
                      </div>

                      {/** Recent emojis */}
                      <p className="text-[11px] font-semibold text-foreground/55">Recent</p>
                      <div className="mb-3 overflow-x-auto overflow-y-hidden">
                        <div className="grid grid-flow-col grid-rows-1 gap-0.5 py-0.5">
                          {filteredRecentEmojiOptions.map((emoji, index) => (
                            (() => {
                              const customEmojiUuid = customEmojiUuidFromToken(emoji);
                              const customEmoji = customEmojiUuid ? customEmojiByUuid[customEmojiUuid] : undefined;
                              if (customEmoji) {
                                return (
                                  <button
                                    key={`recent-${emoji}-${index}`}
                                    type="button"
                                    onClick={() => handleSelectEmoji(emoji)}
                                    className={`flex h-10 w-10 items-center justify-center px-1 py-1 ${emojiTileBase}`}
                                    aria-label={`Insert custom emoji ${customEmoji.name}`}
                                    title={customEmoji.name}
                                  >
                                    <CustomEmoji customEmoji={customEmoji} />
                                  </button>
                                );
                              } else if (customEmojiUuid) {
                                return '?'; // Don't show custom emojis that are not in the custom emoji list.
                              }
                              return (
                                <button
                                  key={`recent-${emoji}-${index}`}
                                  type="button"
                                  onClick={() => handleSelectEmoji(emoji)}
                                  className={`h-10 w-10 px-1 py-1 text-lg ${emojiTileBase}`}
                                  aria-label={`Insert ${emoji}`}
                                >
                                  {emoji}
                                </button>
                              );
                            })()
                          ))}
                        </div>
                      </div>

                      {/** Custom emojis */}
                      {filteredCustomEmojis.length > 0 ? (
                        <>
                          <p className="text-[11px] font-semibold text-foreground/55">Your custom emojis</p>
                          <div className="mb-2 overflow-x-auto overflow-y-hidden pb-1">
                            <div className="grid grid-flow-col grid-rows-1 gap-0.5 py-0.5">
                              {filteredCustomEmojis.map((emoji) => (
                                <button
                                  key={emoji.uuid}
                                  type="button"
                                  onClick={() => handleSelectEmoji(customEmojiToken(emoji.uuid))}
                                  className={`flex h-8 w-8 items-center justify-center px-1 py-1 ${emojiTileBase}`}
                                  aria-label={`Insert custom emoji ${emoji.name}`}
                                  title={emoji.name}
                                >
                                  <CustomEmoji customEmoji={emoji} />
                                </button>
                              ))}
                            </div>
                          </div>
                        </>
                      ) : null}

                      {/** All emojis */}
                      <p className="mb-1.5 text-[11px] font-semibold text-foreground/55">All emojis</p>
                      <div className="overflow-x-auto overflow-y-hidden rounded-xl border border-white/[0.06] bg-black/15 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-sm">
                        <div className="grid h-[11rem] grid-flow-col grid-rows-4 gap-0 px-0.5">
                          {filteredEmojiOptions.map((emoji, index) => (
                            <button
                              key={`${emoji}-${index}`}
                              type="button"
                              onClick={() => handleSelectEmoji(emoji)}
                              className={`h-8 w-8 px-1 py-1 text-xl ${emojiTileBase}`}
                              aria-label={`Insert ${emoji}`}
                              style={{ fontSize: "1.5rem" }}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
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
