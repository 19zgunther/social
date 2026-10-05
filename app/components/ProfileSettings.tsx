"use client";

import { LogOut } from "lucide-react";
import { useState, useEffect } from "react";
import BackButton from "@/app/components/utils/BackButton";
import { clearAllCachedCustomEmojis, getCustomEmojiCacheStats, type CustomEmojiCacheStats } from "@/app/lib/customEmojiCache";
import { clearAllCachedImages, getImageCacheStats, type ImageCacheStats } from "@/app/lib/imageCache";
import { ensurePushSubscription, isInstalledPwa, PUSH_PROMPT_DISMISSED_KEY } from "@/app/lib/pushClient";
import { globalDebugData } from "./utils/globalDebugData";

type ProfileSettingsProps = {
  onBack: () => void;
  onLogout: () => void;
};

export default function ProfileSettings({ onBack, onLogout }: ProfileSettingsProps) {
  const [statusMessage, setStatusMessage] = useState("");
  const [isEnablingNotifications, setIsEnablingNotifications] = useState(false);
  const [isTestingNotifications, setIsTestingNotifications] = useState(false);
  const [isClearingImageCache, setIsClearingImageCache] = useState(false);
  const [isClearingEmojiCache, setIsClearingEmojiCache] = useState(false);
  const [imageCacheStats, setImageCacheStats] = useState<ImageCacheStats | null>(null);
  const [emojiCacheStats, setEmojiCacheStats] = useState<CustomEmojiCacheStats | null>(null);
  const [debugDataSnapshot, setDebugDataSnapshot] = useState(
    JSON.stringify(globalDebugData, null, 2),
  );

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
    const interval = setInterval(() => {
      setDebugDataSnapshot(JSON.stringify(globalDebugData, null, 2));
    }, 1000);
    return () => clearInterval(interval);
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

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-bg"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-3">
        <BackButton onBack={onBack} />
        <h1 className="text-lg font-semibold text-foreground">Settings</h1>
        <div className="w-20" />
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain touch-pan-y px-4 py-4">
        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground mb-3">Notifications</h2>
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
              className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-left text-sm text-foreground hover:bg-border/30 transition mt-2 disabled:cursor-not-allowed disabled:opacity-60"
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
              className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-left text-sm text-foreground hover:bg-border/30 transition mt-2"
            >
              <p className="font-medium">Reset notification prompt</p>
              <p className="text-xs text-muted mt-1">
                Make the notification permission prompt appear again
              </p>
            </button>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-foreground mb-3">Storage</h2>
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
              className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-left text-sm text-foreground hover:bg-border/30 transition disabled:cursor-not-allowed disabled:opacity-60 mt-2"
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
          </div>

          <div>
            <h2 className="text-sm font-semibold text-foreground mb-3">Account</h2>
            <button
              type="button"
              onClick={onLogout}
              className="w-full rounded-lg border border-danger-fill/50 bg-danger-fill/10 px-4 py-3 text-left text-sm text-danger hover:bg-danger-fill/20 transition flex items-center gap-2"
            >
              <LogOut className="h-4 w-4" />
              <p className="font-medium">Log out</p>
            </button>
          </div>

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
            <h2 className="text-sm font-semibold text-foreground mb-3 min-h-100vh overflow-y-scroll min-w-80vw">Debug</h2>
            <textarea
              className="min-h-[100vh] overflow-y-scroll min-w-[80vw]"
              value={debugDataSnapshot}
              readOnly
            />
          </div>
        </section>
      </div>

      {statusMessage ? (
        <div className="border-t border-border px-4 py-3">
          <p className="text-xs text-muted">{statusMessage}</p>
        </div>
      ) : null}
    </div>
  );
}
