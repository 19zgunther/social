import { useCallback, useEffect, useState } from "react";
import { AuthUser } from "@/app/types/interfaces";
import {
  ensurePushSubscription,
  isInstalledPwa,
  PUSH_PROMPT_DISMISSED_KEY,
  type EnsurePushSubscriptionResult,
} from "@/app/lib/pushClient";

function failureMessage(result: Extract<EnsurePushSubscriptionResult, { ok: false }>): string {
  switch (result.reason) {
    case "permission_denied":
      return "Notifications were blocked. Enable them in your device settings for this app.";
    case "unsupported":
      return "This device or browser does not support push notifications.";
    case "not_installed":
      return "Open the app from your home screen icon, then try again.";
    case "permission_default":
      return "Permission was not granted. You can try again or tap Not now.";
    case "failed":
    default:
      return "Could not enable notifications. Try again after reopening the app.";
  }
}

export function AutoNotificationPrompt({
  authUser,
  showNotificationsPrompt,
  setShowNotificationsPrompt,
}: {
  authUser: AuthUser;
  showNotificationsPrompt: boolean;
  setShowNotificationsPrompt: (show: boolean) => void;
}) {
  const [isEnablingNotifications, setIsEnablingNotifications] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const runPushSetup = useCallback(
    async (options?: { requestPermission?: boolean }) => {
      const result = await ensurePushSubscription(options);
      if (!result.ok && result.reason === "permission_denied") {
        setShowNotificationsPrompt(false);
      }
      if (result.ok) {
        setShowNotificationsPrompt(false);
        setErrorMessage("");
      }
      return result;
    },
    [setShowNotificationsPrompt],
  );

  useEffect(() => {
    if (!authUser) {
      return;
    }
    void runPushSetup();
  }, [authUser, runPushSetup]);

  useEffect(() => {
    if (!authUser) {
      setShowNotificationsPrompt(false);
      return;
    }

    if (!("Notification" in window)) {
      setShowNotificationsPrompt(false);
      return;
    }

    const wasDismissed = window.localStorage.getItem(PUSH_PROMPT_DISMISSED_KEY) === "1";
    const shouldShow =
      isInstalledPwa() && Notification.permission === "default" && !wasDismissed;
    setShowNotificationsPrompt(shouldShow);
    if (!shouldShow) {
      setErrorMessage("");
    }
  }, [authUser, setShowNotificationsPrompt]);

  const onEnableNotifications = async () => {
    setIsEnablingNotifications(true);
    setErrorMessage("");
    try {
      const result = await runPushSetup({ requestPermission: true });
      if (!result.ok) {
        if (result.reason === "permission_denied") {
          return;
        }
        setErrorMessage(failureMessage(result));
      }
    } finally {
      setIsEnablingNotifications(false);
      const shouldStillShow =
        "Notification" in window && Notification.permission === "default";
      setShowNotificationsPrompt(shouldStillShow);
    }
  };

  const onDismissNotificationsPrompt = () => {
    window.localStorage.setItem(PUSH_PROMPT_DISMISSED_KEY, "1");
    setErrorMessage("");
    setShowNotificationsPrompt(false);
  };

  if (!showNotificationsPrompt) {
    return null;
  }
  return (
    <div className="absolute inset-0 z-[9999] flex items-center justify-center bg-black/50">
      <div className="mx-4 max-w-sm rounded-lg border border-accent-1 bg-secondary-background p-4 shadow-lg">
        <p className="text-sm text-accent-2">
          Enable notifications to get alerts for new posts, replies, and thread messages.
        </p>
        {errorMessage ? (
          <p className="mt-3 text-sm text-red-400" role="alert">
            {errorMessage}
          </p>
        ) : null}
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void onEnableNotifications();
            }}
            disabled={isEnablingNotifications}
            className="flex-1 rounded-lg bg-accent-3 px-4 py-2 text-sm font-semibold text-primary-background disabled:opacity-60"
          >
            {isEnablingNotifications ? "Enabling..." : "Enable notifications"}
          </button>
          <button
            type="button"
            onClick={onDismissNotificationsPrompt}
            className="flex-1 rounded-lg border border-accent-1 px-4 py-2 text-sm text-accent-2 hover:text-foreground"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
