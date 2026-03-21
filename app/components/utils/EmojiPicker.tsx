"use client";

import { useEffect, useMemo, useState } from "react";
import { Smile } from "lucide-react";
import { createPortal } from "react-dom";
import { ALL_THE_FRICKIN_EMOJIS_I_COULD_FIND } from "./emojiList";
import { DONT_SWIPE_TABS_CLASSNAME } from "./useSwipeBack";

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
const RECENT_EMOJIS_STORAGE_KEY = "emojiPickerRecentUsage";
const RECENT_EMOJIS_STORAGE_BACKUP_KEY = "emojiPickerRecentUsageBackup";
const MAX_RECENT_EMOJIS = 50;

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
  const [searchTerm, setSearchTerm] = useState("");
  const [recentEmojiUsage, setRecentEmojiUsage] = useState<EmojiUsageEntry[]>([]);
  const suggestedEmojiOptions = useMemo(() => DEFAULT_EMOJIS, []);
  const allEmojiOptions = useMemo(() => ALL_THE_FRICKIN_EMOJIS_I_COULD_FIND, []);
  const recentEmojiOptions = useMemo(
    () => recentEmojiUsage.slice(0, MAX_RECENT_EMOJIS).map((entry) => entry.emoji),
    [recentEmojiUsage],
  );
  const filteredEmojiOptions = useMemo(() => {
    if (!searchTerm.trim()) {
      return allEmojiOptions;
    }

    return allEmojiOptions.filter((emoji) => emoji.includes(searchTerm.trim()));
  }, [allEmojiOptions, searchTerm]);

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
                  placeholder="Type or paste an emoji..."
                  className="w-full rounded-md border border-accent-1 bg-background px-2 py-1 text-xs text-foreground outline-none placeholder:text-accent-2/70 focus:border-accent-2"
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
              <p className="mb-1 text-[11px] font-semibold text-accent-2">Suggested</p>
              <div className="mb-3 grid grid-cols-6 gap-1">
                {suggestedEmojiOptions.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => handleSelectEmoji(emoji)}
                    className="rounded-md px-1 py-1 text-base transition hover:bg-accent-1/40"
                    aria-label={`Insert ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
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
