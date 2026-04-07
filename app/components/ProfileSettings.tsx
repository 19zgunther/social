"use client";

import { ArrowLeft, LogOut } from "lucide-react";
import { useState, useEffect } from "react";
import { clearAllCachedCustomEmojis } from "@/app/lib/customEmojiCache";
import { clearAllCachedImages } from "@/app/lib/imageCache";
import { globalDebugData } from "./utils/globalDebugData";

type ProfileSettingsProps = {
  onBack: () => void;
  onLogout: () => void;
};

const PUSH_PROMPT_DISMISSED_KEY = "push_prompt_dismissed";

export default function ProfileSettings({ onBack, onLogout }: ProfileSettingsProps) {
  const [statusMessage, setStatusMessage] = useState("");
  const [isClearingImageCache, setIsClearingImageCache] = useState(false);
  const [isClearingEmojiCache, setIsClearingEmojiCache] = useState(false);
  const [debugDataSnapshot, setDebugDataSnapshot] = useState(
    JSON.stringify(globalDebugData, null, 2),
  );

  const onResetNotificationPrompt = () => {
    window.localStorage.removeItem(PUSH_PROMPT_DISMISSED_KEY);
    setStatusMessage("Notification prompt reset. It will appear again on the next app launch.");
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
        <button
          type="button"
          onClick={onBack}
          className="rounded-full flex gap-2 border border-accent-1 bg-secondary-background px-3 py-2 text-sm text-accent-2 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h1 className="text-lg font-semibold text-foreground">Settings</h1>
        <div className="w-20" />
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain touch-pan-y px-4 py-4">
        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground mb-3">Notifications</h2>
            <button
              type="button"
              onClick={onResetNotificationPrompt}
              className="w-full rounded-lg border border-accent-1 bg-secondary-background px-4 py-3 text-left text-sm text-foreground hover:bg-accent-1/30 transition"
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
    </div>
  );
}
