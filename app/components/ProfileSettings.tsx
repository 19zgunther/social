"use client";

import { NotificationsIcon, DebugIcon, ChevronRightIcon, StorageIcon, LogOutIcon, ThemeIcon, type LucideIcon } from "@/app/components/Icons";
import { useState, useEffect, useRef, type MutableRefObject } from "react";
import BackButton from "@/app/components/utils/BackButton";
import { useSwipeBackOverride } from "@/app/components/utils/useSwipeBack";
import { clearAllCachedCustomEmojis, getCustomEmojiCacheStats, type CustomEmojiCacheStats } from "@/app/lib/customEmojiCache";
import { clearAllCachedImages, getImageCacheStats, type ImageCacheStats } from "@/app/lib/imageCache";
import { ensurePushSubscription, isInstalledPwa, PUSH_PROMPT_DISMISSED_KEY } from "@/app/lib/pushClient";
import {
  DEFAULT_THEME,
  isHexColor,
  NAMED_THEME_PRESETS,
  persistAndApplyTheme,
  readStoredTheme,
  THEME_COLOR_KEYS,
  THEME_COLOR_LABELS,
  themeFromPreset,
  themeWithColorOverride,
  type NamedPresetId,
  type ThemeColors,
  type ThemeInfo,
} from "@/app/lib/theme";
import { globalDebugData } from "./utils/globalDebugData";

type SettingsView = "root" | "appearance" | "notifications" | "storage" | "debug";

type ProfileSettingsProps = {
  onBack: () => void;
  onLogout: () => void;
  swipeBackOverrideRef: MutableRefObject<(() => void) | null>;
};

const SETTINGS_MENU_ITEMS: {
  view: Exclude<SettingsView, "root">;
  label: string;
  icon: LucideIcon;
}[] = [
  { view: "appearance", label: "Appearance", icon: ThemeIcon },
  { view: "notifications", label: "Notifications", icon: NotificationsIcon },
  { view: "storage", label: "Storage", icon: StorageIcon },
  { view: "debug", label: "Debug", icon: DebugIcon },
];

async function postTheme(themeToSave: ThemeInfo): Promise<boolean> {
  const response = await fetch("/api/theme-set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(themeToSave),
  });
  return response.ok;
}

export default function ProfileSettings({
  onBack,
  onLogout,
  swipeBackOverrideRef,
}: ProfileSettingsProps) {
  const [settingsView, setSettingsView] = useState<SettingsView>("root");
  const [statusMessage, setStatusMessage] = useState("");
  const [isEnablingNotifications, setIsEnablingNotifications] = useState(false);
  const [isTestingNotifications, setIsTestingNotifications] = useState(false);
  const [isClearingImageCache, setIsClearingImageCache] = useState(false);
  const [isClearingEmojiCache, setIsClearingEmojiCache] = useState(false);
  const [imageCacheStats, setImageCacheStats] = useState<ImageCacheStats | null>(null);
  const [emojiCacheStats, setEmojiCacheStats] = useState<CustomEmojiCacheStats | null>(null);
  const [theme, setTheme] = useState<ThemeInfo>(() => readStoredTheme() ?? DEFAULT_THEME);
  const [hexDrafts, setHexDrafts] = useState<Record<keyof ThemeColors, string>>({
    ...theme.colors,
  });
  const [isSavingTheme, setIsSavingTheme] = useState(false);
  const themeRef = useRef<ThemeInfo>(theme);
  const themeSaveTimerRef = useRef<number | null>(null);
  const [debugDataSnapshot, setDebugDataSnapshot] = useState(
    JSON.stringify(globalDebugData, null, 2),
  );

  const onBackToRoot = () => {
    setSettingsView("root");
  };

  useSwipeBackOverride(swipeBackOverrideRef, onBackToRoot, settingsView !== "root");

  const saveTheme = (nextTheme: ThemeInfo) => {
    themeRef.current = nextTheme;
    setTheme(nextTheme);
    setHexDrafts({ ...nextTheme.colors });
    persistAndApplyTheme(nextTheme);

    if (themeSaveTimerRef.current !== null) {
      window.clearTimeout(themeSaveTimerRef.current);
    }

    themeSaveTimerRef.current = window.setTimeout(() => {
      themeSaveTimerRef.current = null;

      async function savePendingTheme() {
        setIsSavingTheme(true);
        try {
          const ok = await postTheme(themeRef.current);
          if (!ok) {
            setStatusMessage("Could not save theme. Try again.");
            return;
          }
          setStatusMessage("Theme saved.");
        } catch {
          setStatusMessage("Could not save theme. Try again.");
        } finally {
          setIsSavingTheme(false);
        }
      }

      void savePendingTheme();
    }, 400);
  };

  const onSelectPreset = (presetId: NamedPresetId) => {
    saveTheme(themeFromPreset(presetId));
  };

  const onColorPickerChange = (key: keyof ThemeColors, value: string) => {
    if (!isHexColor(value)) {
      return;
    }
    saveTheme(themeWithColorOverride(themeRef.current, key, value));
  };

  const onHexDraftChange = (key: keyof ThemeColors, value: string) => {
    setHexDrafts((previous) => ({ ...previous, [key]: value }));
    const normalized = value.trim();
    if (!isHexColor(normalized)) {
      return;
    }
    saveTheme(themeWithColorOverride(themeRef.current, key, normalized));
  };

  const onResetTheme = () => {
    saveTheme(DEFAULT_THEME);
  };

  const onResetNotificationPrompt = () => {
    window.localStorage.removeItem(PUSH_PROMPT_DISMISSED_KEY);
    setStatusMessage("Notification prompt reset. It will appear again on the next app launch.");
  };

  const onEnableNotifications = async () => {
    if (isEnablingNotifications) {
      return;
    }

    setIsEnablingNotifications(true);
    try {
      if (!isInstalledPwa()) {
        setStatusMessage(
          "Open the app from your home screen icon (installed app), not from the browser, then try again.",
        );
        return;
      }

      const result = await ensurePushSubscription({ requestPermission: true });
      if (result.ok) {
        setStatusMessage("Notifications enabled.");
        return;
      }

      if (result.reason === "permission_denied") {
        setStatusMessage("Notifications were blocked. Enable them in your device settings for this app.");
        return;
      }

      if (result.reason === "unsupported") {
        setStatusMessage("This device or browser does not support push notifications.");
        return;
      }

      setStatusMessage("Could not enable notifications. Try again after reopening the app.");
    } finally {
      setIsEnablingNotifications(false);
    }
  };

  const onTestNotifications = async () => {
    if (isTestingNotifications) {
      return;
    }

    setIsTestingNotifications(true);
    try {
      if (!isInstalledPwa()) {
        setStatusMessage(
          "Open the app from your home screen icon (installed app), not from the browser, then try again.",
        );
        return;
      }

      const subscriptionResult = await ensurePushSubscription({ requestPermission: true });
      if (!subscriptionResult.ok) {
        if (subscriptionResult.reason === "permission_denied") {
          setStatusMessage("Notifications were blocked. Enable them in your device settings for this app.");
          return;
        }
        if (subscriptionResult.reason === "unsupported") {
          setStatusMessage("This device or browser does not support push notifications.");
          return;
        }
        setStatusMessage("Could not register this device for notifications. Enable notifications first.");
        return;
      }

      const response = await fetch("/api/push-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setStatusMessage(
          payload?.error?.message ?? "Failed to send test notification. Try again.",
        );
        return;
      }

      setStatusMessage("Test notification sent. Check your device notification tray.");
    } finally {
      setIsTestingNotifications(false);
    }
  };

  const refreshImageCacheStats = async () => {
    const stats = await getImageCacheStats();
    setImageCacheStats(stats);
  };

  const refreshEmojiCacheStats = async () => {
    const stats = await getCustomEmojiCacheStats();
    setEmojiCacheStats(stats);
  };

  const onClearImageCache = async () => {
    if (isClearingImageCache) {
      return;
    }

    setIsClearingImageCache(true);
    try {
      await clearAllCachedImages();
      setImageCacheStats({ count: 0, totalBytes: 0 });
      setStatusMessage("Image cache cleared.");
    } finally {
      setIsClearingImageCache(false);
    }
  };

  const onClearCustomEmojiCache = async () => {
    if (isClearingEmojiCache) {
      return;
    }

    setIsClearingEmojiCache(true);
    try {
      await clearAllCachedCustomEmojis();
      setEmojiCacheStats({ count: 0, totalBytes: 0 });
      setStatusMessage("Custom emoji cache cleared.");
    } finally {
      setIsClearingEmojiCache(false);
    }
  };

  useEffect(() => {
    void refreshImageCacheStats();
    void refreshEmojiCacheStats();
  }, []);

  useEffect(() => {
    if (settingsView !== "debug") {
      return;
    }
    const interval = setInterval(() => {
      setDebugDataSnapshot(JSON.stringify(globalDebugData, null, 2));
    }, 1000);
    return () => clearInterval(interval);
  }, [settingsView]);

  useEffect(() => {
    return () => {
      if (themeSaveTimerRef.current === null) {
        return;
      }
      window.clearTimeout(themeSaveTimerRef.current);
      themeSaveTimerRef.current = null;
      void postTheme(themeRef.current);
    };
  }, []);

  const formatCacheStatsLabel = (
    stats: { count: number; totalBytes: number } | null,
    singular: string,
    plural: string,
  ): string => {
    if (!stats) {
      return "";
    }
    const countLabel = stats.count === 1 ? `1 ${singular}` : `${stats.count} ${plural}`;
    const { totalBytes } = stats;
    let sizeLabel = `${totalBytes} B`;
    if (totalBytes >= 1024 * 1024) {
      sizeLabel = `~${(totalBytes / (1024 * 1024)).toFixed(1)} MB`;
    } else if (totalBytes >= 1024) {
      sizeLabel = `~${(totalBytes / 1024).toFixed(0)} KB`;
    }
    return `${countLabel} · ${sizeLabel}`;
  };

  const imageCacheStatsLabel = formatCacheStatsLabel(imageCacheStats, "image", "images");
  const emojiCacheStatsLabel = formatCacheStatsLabel(emojiCacheStats, "emoji", "emojis");

  const headerTitle =
    settingsView === "root"
      ? "Settings"
      : SETTINGS_MENU_ITEMS.find((item) => item.view === settingsView)?.label ?? "Settings";

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <div className="flex items-center justify-between border-b border-border px-3 py-3">
        <BackButton onBack={settingsView === "root" ? onBack : onBackToRoot} />
        <h1 className="text-lg font-semibold text-foreground">{headerTitle}</h1>
        <div className="w-20" />
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain touch-pan-y px-4 py-4">
        {settingsView === "root" ? (
          <section className="space-y-2">
            {SETTINGS_MENU_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.view}
                  type="button"
                  onClick={() => {
                    setSettingsView(item.view);
                  }}
                  className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-4 py-3 text-left text-sm text-foreground hover:bg-border/30 transition"
                >
                  <span className="flex items-center gap-3">
                    <Icon className="h-4 w-4 shrink-0 text-muted" />
                    <span className="font-medium">{item.label}</span>
                  </span>
                  <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted" />
                </button>
              );
            })}

            <button
              type="button"
              onClick={onLogout}
              className="mt-4 flex w-full items-center gap-2 rounded-lg border border-danger-fill/50 bg-danger-fill/10 px-4 py-3 text-left text-sm text-danger hover:bg-danger-fill/20 transition"
            >
              <LogOutIcon className="h-4 w-4" />
              <p className="font-medium">Log out</p>
            </button>
          </section>
        ) : null}

        {settingsView === "appearance" ? (
          <section className="space-y-3">
            <p className="text-xs text-muted">
              Choose a preset or customize individual colors
              {isSavingTheme ? " · Saving…" : ""}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {NAMED_THEME_PRESETS.map((preset) => {
                const isSelected = theme.presetId === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      onSelectPreset(preset.id);
                    }}
                    className={`rounded-lg border px-3 py-3 text-left transition ${
                      isSelected
                        ? "border-accent bg-accent/15"
                        : "border-border bg-surface hover:bg-border/30"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="h-8 w-8 shrink-0 rounded-md border border-border"
                        style={{
                          background: `linear-gradient(135deg, ${preset.colors.bg} 45%, ${preset.colors.accent} 45%)`,
                        }}
                        aria-hidden
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{preset.label}</p>
                        <p className="text-xs text-muted truncate">{preset.colors.accent}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            {theme.presetId === "custom" ? (
              <p className="text-xs text-muted">Custom palette</p>
            ) : null}

            <div className="space-y-2 rounded-lg border border-border bg-surface px-3 py-3">
              <p className="text-sm font-medium text-foreground">Customize colors</p>
              {THEME_COLOR_KEYS.map((key) => (
                <div key={key} className="flex items-center gap-2">
                  <label className="w-24 shrink-0 text-xs text-muted" htmlFor={`theme-color-${key}`}>
                    {THEME_COLOR_LABELS[key]}
                  </label>
                  <input
                    id={`theme-color-${key}`}
                    type="color"
                    value={theme.colors[key]}
                    onChange={(event) => {
                      onColorPickerChange(key, event.target.value);
                    }}
                    className="h-9 w-10 shrink-0 cursor-pointer rounded border border-border bg-bg p-0.5"
                  />
                  <input
                    type="text"
                    value={hexDrafts[key]}
                    onChange={(event) => {
                      onHexDraftChange(key, event.target.value);
                    }}
                    spellCheck={false}
                    maxLength={7}
                    className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-accent"
                    aria-label={`${THEME_COLOR_LABELS[key]} hex`}
                  />
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={onResetTheme}
              className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-left text-sm text-foreground hover:bg-border/30 transition"
            >
              <p className="font-medium">Reset to default theme</p>
              <p className="text-xs text-muted mt-1">Restore the original dark purple palette</p>
            </button>
          </section>
        ) : null}

        {settingsView === "notifications" ? (
          <section className="space-y-2">
            <button
              type="button"
              onClick={() => {
                void onEnableNotifications();
              }}
              disabled={isEnablingNotifications}
              className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-left text-sm text-foreground hover:bg-border/30 transition disabled:cursor-not-allowed disabled:opacity-60"
            >
              <p className="font-medium">
                {isEnablingNotifications ? "Enabling notifications..." : "Enable notifications"}
              </p>
              <p className="text-xs text-muted mt-1">
                Register this device for post, reply, and thread message alerts
              </p>
            </button>
            <button
              type="button"
              onClick={() => {
                void onTestNotifications();
              }}
              disabled={isTestingNotifications}
              className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-left text-sm text-foreground hover:bg-border/30 transition disabled:cursor-not-allowed disabled:opacity-60"
            >
              <p className="font-medium">
                {isTestingNotifications ? "Sending test notification..." : "Send test notification"}
              </p>
              <p className="text-xs text-muted mt-1">
                Push a sample alert to this device to verify notifications work
              </p>
            </button>
            <button
              type="button"
              onClick={onResetNotificationPrompt}
              className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-left text-sm text-foreground hover:bg-border/30 transition"
            >
              <p className="font-medium">Reset notification prompt</p>
              <p className="text-xs text-muted mt-1">
                Make the notification permission prompt appear again
              </p>
            </button>
          </section>
        ) : null}

        {settingsView === "storage" ? (
          <section className="space-y-2">
            <button
              type="button"
              onClick={() => { void onClearImageCache(); }}
              disabled={isClearingImageCache}
              className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-left text-sm text-foreground hover:bg-border/30 transition disabled:cursor-not-allowed disabled:opacity-60"
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-medium">{isClearingImageCache ? "Clearing image cache..." : "Clear cached images"}</p>
                {imageCacheStatsLabel ? (
                  <p className="shrink-0 text-xs text-muted">{imageCacheStatsLabel}</p>
                ) : null}
              </div>
              <p className="text-xs text-muted mt-1">
                Remove all locally cached images and reload them as needed
              </p>
            </button>
            <button
              type="button"
              onClick={() => { void onClearCustomEmojiCache(); }}
              disabled={isClearingEmojiCache}
              className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-left text-sm text-foreground hover:bg-border/30 transition disabled:cursor-not-allowed disabled:opacity-60"
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-medium">{isClearingEmojiCache ? "Clearing custom emoji cache..." : "Clear cached custom emojis"}</p>
                {emojiCacheStatsLabel ? (
                  <p className="shrink-0 text-xs text-muted">{emojiCacheStatsLabel}</p>
                ) : null}
              </div>
              <p className="text-xs text-muted mt-1">
                Remove locally cached custom emoji pixel data (they reload from the server when needed)
              </p>
            </button>
          </section>
        ) : null}

        {settingsView === "debug" ? (
          <section className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground mb-3">Logo</h2>
              <div className="flex justify-center">
                <div
                  className="logo-rgb-bg h-48 w-48"
                  aria-label="Zo logo"
                >
                  <span className="logo-zo-mark text-[3.25rem]" data-text="Zo">
                    <span className="logo-zo-face">Zo</span>
                  </span>
                </div>
              </div>
              <p className="mt-2 text-center text-xs text-muted">
                Screenshot this mark for favicon and app icons
              </p>
            </div>

            <div>
              <h2 className="text-sm font-semibold text-foreground mb-3">Debug data</h2>
              <textarea
                className="min-h-[100vh] w-full overflow-y-scroll rounded-lg border border-border bg-surface p-3 font-mono text-xs text-foreground"
                value={debugDataSnapshot}
                readOnly
              />
            </div>
          </section>
        ) : null}
      </div>

      {statusMessage ? (
        <div className="border-t border-border px-4 py-3">
          <p className="text-xs text-muted">{statusMessage}</p>
        </div>
      ) : null}
    </div>
  );
}
