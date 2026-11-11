"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackIcon, EmojiIcon, CloseIcon } from "@/app/components/Icons";
import emojiKeywordsByEmoji from "emojilib";
import AnimatedModal, { useAnimatedModal } from "@/app/components/utils/AnimatedModal";
import { DONT_SWIPE_TABS_CLASSNAME } from "./useSwipeBack";
import { loadAllCustomEmojis, resolveEmojisByUuid } from "@/app/lib/customEmojiCache";
import { EmojiItem } from "@/app/types/interfaces";
import { CustomEmoji } from "@/app/lib/customEmojiCanvas";
import EmojiEditorTab from "@/app/components/EmojiEditorTab";
import Loader from "@/app/components/Loader";
const RECENT_EMOJIS_STORAGE_KEY = "emojiPickerRecentUsage";
const RECENT_EMOJIS_STORAGE_BACKUP_KEY = "emojiPickerRecentUsageBackup";
const MAX_RECENT_EMOJIS = 50;
const MAX_UNRESOLVED_RECENT_CUSTOM_EMOJI_REFRESHES = 10;
const UNRESOLVED_RECENT_CUSTOM_EMOJI_REFRESH_MS = 1000;
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

const mergeCustomEmojiLists = (
  primary: EmojiItem[],
  extra: Record<string, EmojiItem>,
): EmojiItem[] => {
  const byUuid = new Map(primary.map((emoji) => [emoji.uuid, emoji]));
  for (const emoji of Object.values(extra)) {
    byUuid.set(emoji.uuid, emoji);
  }
  return [...byUuid.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
};

const unresolvedCustomEmojiUuidsFromRecent = (
  recentOptions: string[],
  emojiByUuid: Record<string, EmojiItem>,
): string[] => {
  const uuids = recentOptions
    .map((emoji) => customEmojiUuidFromToken(emoji))
    .filter((uuid): uuid is string => Boolean(uuid))
    .filter((uuid) => !emojiByUuid[uuid]);
  return [...new Set(uuids)];
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
  disabled?: boolean;
  /** Hide the smile trigger button (modal can still open via openRequestId). */
  hideTrigger?: boolean;
  /** Increment to open the picker from outside (e.g. attach menu). */
  openRequestId?: number;
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
  disabled = false,
  hideTrigger = false,
  openRequestId,
}: EmojiPickerProps) {
  const {
    isPresented,
    isClosing,
    isActive: isOpen,
    open: openPicker,
    close: closePicker,
  } = useAnimatedModal();
  const [showEmojiEditor, setShowEmojiEditor] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [recentEmojiUsage, setRecentEmojiUsage] = useState<EmojiUsageEntry[]>([]);
  const [customEmojis, setCustomEmojis] = useState<EmojiItem[]>([]);
  const [hasLoadedCustomEmojis, setHasLoadedCustomEmojis] = useState(false);
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
  }, []);

  const refreshCustomEmojis = useCallback(async (resolveUuids?: string[]) => {
    try {
      const uuidsToResolve = resolveUuids?.filter(Boolean) ?? [];
      const [emojis, resolved] = await Promise.all([
        loadAllCustomEmojis(),
        uuidsToResolve.length > 0 ? resolveEmojisByUuid(uuidsToResolve) : Promise.resolve({}),
      ]);
      setCustomEmojis(mergeCustomEmojiLists(emojis, resolved));
    } catch {
      // Ignore custom emoji loading failures; default emoji picker still works.
    } finally {
      setHasLoadedCustomEmojis(true);
    }
  }, []);

  const recentEmojiOptionsRef = useRef(recentEmojiOptions);
  recentEmojiOptionsRef.current = recentEmojiOptions;
  const customEmojiByUuidRef = useRef(customEmojiByUuid);
  customEmojiByUuidRef.current = customEmojiByUuid;

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    let cancelled = false;
    const loadCustomEmojis = async () => {
      const missingUuids = unresolvedCustomEmojiUuidsFromRecent(
        recentEmojiOptionsRef.current,
        customEmojiByUuidRef.current,
      );
      try {
        const [emojis, resolved] = await Promise.all([
          loadAllCustomEmojis(),
          missingUuids.length > 0 ? resolveEmojisByUuid(missingUuids) : Promise.resolve({}),
        ]);
        if (!cancelled) {
          setCustomEmojis(mergeCustomEmojiLists(emojis, resolved));
        }
      } catch {
        // Ignore custom emoji loading failures; default emoji picker still works.
      } finally {
        if (!cancelled) {
          setHasLoadedCustomEmojis(true);
        }
      }
    };
    void loadCustomEmojis();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let cancelled = false;
    let refreshCount = 0;
    let intervalId: number | undefined;

    const stopPolling = () => {
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
        intervalId = undefined;
      }
    };

    const pollUnresolvedRecentCustomEmojis = async () => {
      if (cancelled || refreshCount >= MAX_UNRESOLVED_RECENT_CUSTOM_EMOJI_REFRESHES) {
        stopPolling();
        return;
      }

      const missingUuids = unresolvedCustomEmojiUuidsFromRecent(
        recentEmojiOptionsRef.current,
        customEmojiByUuidRef.current,
      );
      if (missingUuids.length === 0) {
        stopPolling();
        return;
      }

      refreshCount += 1;
      await refreshCustomEmojis(missingUuids);

      if (
        cancelled ||
        refreshCount >= MAX_UNRESOLVED_RECENT_CUSTOM_EMOJI_REFRESHES ||
        unresolvedCustomEmojiUuidsFromRecent(
          recentEmojiOptionsRef.current,
          customEmojiByUuidRef.current,
        ).length === 0
      ) {
        stopPolling();
      }
    };

    intervalId = window.setInterval(() => {
      void pollUnresolvedRecentCustomEmojis();
    }, UNRESOLVED_RECENT_CUSTOM_EMOJI_REFRESH_MS);

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [isOpen, refreshCustomEmojis]);

  useEffect(() => {
    if (!isPresented) {
      setShowEmojiEditor(false);
    }
  }, [isPresented]);

  useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  useEffect(() => {
    if (openRequestId === undefined || openRequestId <= 0 || disabled) {
      return;
    }
    openPicker();
  }, [disabled, openPicker, openRequestId]);

  const handleSelectEmoji = (emoji: string) => {
    try {
      onSelectEmoji(emoji);
    } finally {
      const now = Date.now();
      const latestStoredUsage = loadStoredUsage();
      const updatedUsage = updateUsageWithSelection(latestStoredUsage, emoji, now);
      persistUsage(updatedUsage);
      setRecentEmojiUsage(updatedUsage);
      closePicker();
    }
  };

  const emojiTileBase =
    "rounded-lg transition hover:bg-surface active:scale-95";

  return (
    <div className={DONT_SWIPE_TABS_CLASSNAME + " " + (className ?? "")}>
      {!hideTrigger ? (
        <button
          type="button"
          onClick={() => {
            if (isOpen) {
              closePicker();
            } else {
              openPicker();
            }
          }}
          className={`rounded-lg border border-border px-2 py-1 text-muted transition hover:text-foreground ${buttonClassName ?? ""}`}
          style={{ transform: "translateY(-2px)" }} // fuck it now it looks good
          aria-label="Add emoji"
          disabled={disabled}
        >
          <EmojiIcon className={`h-4 w-4 ${buttonSmileIconClassName ?? ""}`} />
        </button>
      ) : null}

      <AnimatedModal
        isPresented={isPresented}
        isClosing={isClosing}
        onClose={closePicker}
        onEscape={() => {
          if (showEmojiEditor) {
            setShowEmojiEditor(false);
          } else {
            closePicker();
          }
        }}
        ariaLabel={showEmojiEditor ? "Custom emoji editor" : "Emoji picker"}
        title={showEmojiEditor ? undefined : "Choose an emoji"}
        hideHeader={showEmojiEditor}
        headerActions={
          <button
            type="button"
            onClick={() => setShowEmojiEditor(true)}
            className="create-post-rgb-border shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold"
          >
            <span className="create-post-rgb-text">+ Create Emoji</span>
          </button>
        }
        rootClassName="z-[2000] px-3"
        panelClassName={`h-[min(85dvh,720px)] ${showEmojiEditor ? "max-w-md" : "max-w-sm"} bg-bg shadow-xl`}
      >
        {showEmojiEditor ? (
          <>
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 pb-2 pt-3">
              <button
                type="button"
                onClick={() => setShowEmojiEditor(false)}
                className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-foreground"
              >
                <BackIcon className="h-4 w-4 shrink-0" />
                Back to picker
              </button>
              <button
                type="button"
                onClick={() => closePicker()}
                aria-label="Close"
                className="rounded-full p-1.5 text-muted transition hover:bg-surface hover:text-foreground"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <EmojiEditorTab isActive onSaved={refreshCustomEmojis} />
            </div>
          </>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
            <div className="mb-3">
              <label htmlFor="emoji-search" className="mb-1 block text-xs text-muted">
                Search
              </label>
              <input
                id="emoji-search"
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Emoji, keyword, or custom name..."
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted focus:border-muted"
              />
            </div>

            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Recent</p>
            <div className="mb-3 overflow-x-auto overflow-y-hidden">
              <div className="grid grid-flow-col grid-rows-1 gap-0 py-0">
                {filteredRecentEmojiOptions.map((emoji, index) => {
                  const customEmojiUuid = customEmojiUuidFromToken(emoji);
                  const customEmoji = customEmojiUuid ? customEmojiByUuid[customEmojiUuid] : undefined;
                  if (customEmoji) {
                    return (
                      <button
                        key={`recent-${emoji}-${index}`}
                        type="button"
                        onClick={() => handleSelectEmoji(emoji)}
                        className={`flex h-[3rem] w-[3rem] items-center justify-center px-0 py-0 [&_canvas]:!h-9 [&_canvas]:!w-9 ${emojiTileBase}`}
                        aria-label={`Insert custom emoji ${customEmoji.name}`}
                        title={customEmoji.name}
                      >
                        <CustomEmoji customEmoji={customEmoji} enablePeek={false} />
                      </button>
                    );
                  }
                  if (customEmojiUuid) {
                    return (
                      <span
                        key={`recent-pending-${emoji}-${index}`}
                        className="flex h-[3rem] w-[3rem] items-center justify-center text-sm text-muted animate-pulse"
                        aria-hidden="true"
                      >
                        …
                      </span>
                    );
                  }
                  return (
                    <button
                      key={`recent-${emoji}-${index}`}
                      type="button"
                      onClick={() => handleSelectEmoji(emoji)}
                      className={`h-[3rem] w-[3rem] px-0 py-0 text-[1.46rem] leading-none ${emojiTileBase}`}
                      aria-label={`Insert ${emoji}`}
                    >
                      {emoji}
                    </button>
                  );
                })}
              </div>
            </div>

            {!hasLoadedCustomEmojis || filteredCustomEmojis.length > 0 || !trimmedSearchTerm ? (
              <>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                  Your custom emojis
                </p>
                <div className="relative mb-3 overflow-x-auto overflow-y-hidden pb-1">
                  <div
                    className="grid h-[calc(4*2.6rem)] grid-flow-col grid-rows-4 gap-0.5 py-0.5"
                    aria-busy={!hasLoadedCustomEmojis || undefined}
                  >
                    {hasLoadedCustomEmojis
                      ? filteredCustomEmojis.map((emoji) => (
                          <button
                            key={emoji.uuid}
                            type="button"
                            onClick={() => handleSelectEmoji(customEmojiToken(emoji.uuid))}
                            className={`flex h-[2.6rem] w-[2.6rem] items-center justify-center px-1 py-1 [&_canvas]:!h-9 [&_canvas]:!w-9 ${emojiTileBase}`}
                            aria-label={`Insert custom emoji ${emoji.name}`}
                            title={emoji.name}
                          >
                            <CustomEmoji customEmoji={emoji} enablePeek={false} />
                          </button>
                        ))
                      : null}
                  </div>
                  {!hasLoadedCustomEmojis ? (
                    <div
                      className="pointer-events-none absolute inset-0 flex items-center justify-center"
                      role="status"
                      aria-label="Loading custom emojis"
                    >
                      <Loader scale={0.55} animateHeight={false} />
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}

            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">All emojis</p>
            <div className="overflow-x-auto overflow-y-hidden">
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
          </div>
        )}
      </AnimatedModal>
    </div>
  );
}
