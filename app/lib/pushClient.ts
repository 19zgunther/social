const PUSH_PROMPT_DISMISSED_KEY = "push_prompt_dismissed";

export { PUSH_PROMPT_DISMISSED_KEY };

/** True when the app is running as an installed PWA (home screen), not a browser tab. */
export const isInstalledPwa = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }

  if (window.matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches) {
    return true;
  }

  if (Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone)) {
    return true;
  }

  // Android WebAPK launches set this referrer.
  if (document.referrer.startsWith("android-app://")) {
    return true;
  }

  return false;
};

const urlBase64ToArrayBuffer = (base64String: string): ArrayBuffer => {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputBuffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(outputBuffer);
  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }
  return outputBuffer;
};

export type EnsurePushSubscriptionResult =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "not_installed" | "permission_denied" | "permission_default" | "failed" };

export async function ensurePushSubscription(options?: {
  requestPermission?: boolean;
}): Promise<EnsurePushSubscriptionResult> {
  try {
    if (
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      return { ok: false, reason: "unsupported" };
    }

    if (!isInstalledPwa()) {
      return { ok: false, reason: "not_installed" };
    }

    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    let permission = Notification.permission;
    if (permission === "default" && options?.requestPermission) {
      permission = await Notification.requestPermission();
    }

    if (permission === "default") {
      return { ok: false, reason: "permission_default" };
    }

    if (permission !== "granted") {
      const existingSubscription = await registration.pushManager.getSubscription();
      if (existingSubscription) {
        await fetch("/api/push-unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            endpoint: existingSubscription.endpoint,
          }),
        });
        await existingSubscription.unsubscribe();
      }
      window.localStorage.setItem(PUSH_PROMPT_DISMISSED_KEY, "1");
      return { ok: false, reason: "permission_denied" };
    }

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const keyResponse = await fetch("/api/push-public-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!keyResponse.ok) {
        return { ok: false, reason: "failed" };
      }
      const keyPayload = (await keyResponse.json()) as { vapid_public_key?: string };
      if (!keyPayload.vapid_public_key) {
        return { ok: false, reason: "failed" };
      }

      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToArrayBuffer(keyPayload.vapid_public_key),
      });
    }

    const serializedSubscription = subscription.toJSON();
    if (
      !serializedSubscription.endpoint ||
      !serializedSubscription.keys?.p256dh ||
      !serializedSubscription.keys.auth
    ) {
      return { ok: false, reason: "failed" };
    }

    const subscribeResponse = await fetch("/api/push-subscribe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        endpoint: serializedSubscription.endpoint,
        keys: {
          p256dh: serializedSubscription.keys.p256dh,
          auth: serializedSubscription.keys.auth,
        },
      }),
    });
    if (!subscribeResponse.ok) {
      console.error("push_subscribe_save_failed", subscribeResponse.status);
      return { ok: false, reason: "failed" };
    }

    window.localStorage.removeItem(PUSH_PROMPT_DISMISSED_KEY);
    return { ok: true };
  } catch (error) {
    console.error("push_setup_failed", error);
    return { ok: false, reason: "failed" };
  }
}
