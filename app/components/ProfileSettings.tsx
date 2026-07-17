"use client";

import { LogOut } from "lucide-react";
import { useState, useEffect } from "react";
import BackButton from "@/app/components/utils/BackButton";
import { LoadingAnimation, AnimationEditorModal } from "@/app/components/animator";
import { clearAllCachedCustomEmojis } from "@/app/lib/customEmojiCache";
import { clearAllCachedImages } from "@/app/lib/imageCache";
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
  const [editorOpen, setEditorOpen] = useState(false);
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

  const onClearImageCache = async () => {
    if (isClearingImageCache) {
      return;
    }

    setIsClearingImageCache(true);
    try {
      await clearAllCachedImages();
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
      setStatusMessage("Custom emoji cache cleared.");
    } finally {
      setIsClearingEmojiCache(false);
    }
  };

  useEffect(() => {
    const interval = setInterval(() => {
      setDebugDataSnapshot(JSON.stringify(globalDebugData, null, 2));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-primary-background"
    >
      <div className="flex items-center justify-between border-b border-accent-1 px-3 py-3">
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
              className="w-full rounded-lg border border-accent-1 bg-secondary-background px-4 py-3 text-left text-sm text-foreground hover:bg-accent-1/30 transition disabled:cursor-not-allowed disabled:opacity-60"
            >
              <p className="font-medium">
                {isEnablingNotifications ? "Enabling notifications..." : "Enable notifications"}
              </p>
              <p className="text-xs text-accent-2 mt-1">
                Register this device for post, reply, and thread message alerts
              </p>
            </button>
            <button
              type="button"
              onClick={() => {
                void onTestNotifications();
              }}
              disabled={isTestingNotifications}
              className="w-full rounded-lg border border-accent-1 bg-secondary-background px-4 py-3 text-left text-sm text-foreground hover:bg-accent-1/30 transition mt-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <p className="font-medium">
                {isTestingNotifications ? "Sending test notification..." : "Send test notification"}
              </p>
              <p className="text-xs text-accent-2 mt-1">
                Push a sample alert to this device to verify notifications work
              </p>
            </button>
            <button
              type="button"
              onClick={onResetNotificationPrompt}
              className="w-full rounded-lg border border-accent-1 bg-secondary-background px-4 py-3 text-left text-sm text-foreground hover:bg-accent-1/30 transition mt-2"
            >
              <p className="font-medium">Reset notification prompt</p>
              <p className="text-xs text-accent-2 mt-1">
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
              className="w-full rounded-lg border border-accent-1 bg-secondary-background px-4 py-3 text-left text-sm text-foreground hover:bg-accent-1/30 transition disabled:cursor-not-allowed disabled:opacity-60"
            >
              <p className="font-medium">{isClearingImageCache ? "Clearing image cache..." : "Clear cached images"}</p>
              <p className="text-xs text-accent-2 mt-1">
                Remove all locally cached images and reload them as needed
              </p>
            </button>
            <button
              type="button"
              onClick={() => { void onClearCustomEmojiCache(); }}
              disabled={isClearingEmojiCache}
              className="w-full rounded-lg border border-accent-1 bg-secondary-background px-4 py-3 text-left text-sm text-foreground hover:bg-accent-1/30 transition disabled:cursor-not-allowed disabled:opacity-60 mt-2"
            >
              <p className="font-medium">{isClearingEmojiCache ? "Clearing custom emoji cache..." : "Clear cached custom emojis"}</p>
              <p className="text-xs text-accent-2 mt-1">
                Remove locally cached custom emoji pixel data (they reload from the server when needed)
              </p>
            </button>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-foreground mb-3">Account</h2>
            <button
              type="button"
              onClick={onLogout}
              className="w-full rounded-lg border border-red-600/50 bg-red-600/10 px-4 py-3 text-left text-sm text-red-600 hover:bg-red-600/20 transition flex items-center gap-2"
            >
              <LogOut className="h-4 w-4" />
              <p className="font-medium">Log out</p>
            </button>
          </div>

          <div className="flex flex-col items-center gap-2 pt-2 pb-6">
            <LoadingAnimation size={96} color="white" />
            <button
              type="button"
              onClick={() => {
                setEditorOpen(true);
              }}
              className="rounded-lg border border-accent-1 bg-secondary-background px-4 py-2 text-sm text-foreground hover:bg-accent-1/30 transition"
            >
              Edit loading animation
            </button>
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
        <div className="border-t border-accent-1 px-4 py-3">
          <p className="text-xs text-accent-2">{statusMessage}</p>
        </div>
      ) : null}

      <AnimationEditorModal
        open={editorOpen}
        onClose={() => {
          setEditorOpen(false);
        }}
      />
    </div>
  );
}
