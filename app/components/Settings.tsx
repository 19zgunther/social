"use client";

import { ArrowLeft, LogOut } from "lucide-react";
import { useState } from "react";
import useSwipeBack from "@/app/components/utils/useSwipeBack";

type SettingsProps = {
  onBack: () => void;
  onLogout: () => void;
};

const PUSH_PROMPT_DISMISSED_KEY = "push_prompt_dismissed";

export default function Settings({ onBack, onLogout }: SettingsProps) {
  const [statusMessage, setStatusMessage] = useState("");

  const onResetNotificationPrompt = () => {
    window.localStorage.removeItem(PUSH_PROMPT_DISMISSED_KEY);
    setStatusMessage("Notification prompt reset. It will appear again on the next app launch.");
  };

  const { onTouchStart, onTouchEnd } = useSwipeBack({ onBack });

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-primary-background"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
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
