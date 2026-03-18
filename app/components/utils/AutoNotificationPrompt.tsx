import { useCallback, useEffect, useState } from "react";
import { AuthUser } from "@/app/types/interfaces";

const PUSH_PROMPT_DISMISSED_KEY = "push_prompt_dismissed";


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

    const ensurePushSubscription = useCallback(async (options?: { requestPermission?: boolean }) => {
        try {
            if (
                !("serviceWorker" in navigator) ||
                !("PushManager" in window) ||
                !("Notification" in window)
            ) {
                return;
            }

            const isStandalone =
                window.matchMedia("(display-mode: standalone)").matches ||
                Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
            if (!isStandalone) {
                return;
            }

            const registration = await navigator.serviceWorker.register("/sw.js");

            let permission = Notification.permission;
            if (permission === "default" && options?.requestPermission) {
                permission = await Notification.requestPermission();
            }

            if (permission === "default") {
                return;
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
                setShowNotificationsPrompt(false);
                return;
            }

            let subscription = await registration.pushManager.getSubscription();
            if (!subscription) {
                const keyResponse = await fetch("/api/push-public-key", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({}),
                });
                if (!keyResponse.ok) {
                    return;
                }
                const keyPayload = (await keyResponse.json()) as { vapid_public_key?: string };
                if (!keyPayload.vapid_public_key) {
                    return;
                }

                subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToArrayBuffer(keyPayload.vapid_public_key),
                });
            }

            const serializedSubscription = subscription.toJSON();
            if (!serializedSubscription.endpoint || !serializedSubscription.keys?.p256dh || !serializedSubscription.keys.auth) {
                return;
            }

            await fetch("/api/push-subscribe", {
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
            window.localStorage.removeItem(PUSH_PROMPT_DISMISSED_KEY);
            setShowNotificationsPrompt(false);
        } catch (error) {
            console.error("push_setup_failed", error);
        }
    }, []);

    useEffect(() => {
        if (!authUser) {
            return;
        }
        void ensurePushSubscription();
    }, [authUser, ensurePushSubscription]);

    useEffect(() => {
        if (!authUser) {
            setShowNotificationsPrompt(false);
            return;
        }

        if (!("Notification" in window)) {
            setShowNotificationsPrompt(false);
            return;
        }

        const isStandalone =
            window.matchMedia("(display-mode: standalone)").matches ||
            Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
        const wasDismissed = window.localStorage.getItem(PUSH_PROMPT_DISMISSED_KEY) === "1";
        const shouldShow =
            isStandalone && Notification.permission === "default" && !wasDismissed;
        setShowNotificationsPrompt(shouldShow);
    }, [authUser]);

    const onEnableNotifications = async () => {
        setIsEnablingNotifications(true);
        try {
            await ensurePushSubscription({ requestPermission: true });
        } finally {
            setIsEnablingNotifications(false);
            const shouldStillShow =
                "Notification" in window && Notification.permission === "default";
            setShowNotificationsPrompt(shouldStillShow);
        }
    };

    const onDismissNotificationsPrompt = () => {
        window.localStorage.setItem(PUSH_PROMPT_DISMISSED_KEY, "1");
        setShowNotificationsPrompt(false);
    };

    if (!showNotificationsPrompt) { return null; }
    return (
        <div className="absolute inset-0 z-[9999] flex items-center justify-center bg-black/50">
            <div className="mx-4 max-w-sm rounded-lg border border-accent-1 bg-secondary-background p-4 shadow-lg">
                <p className="text-sm text-accent-2">
                    Enable notifications to get new thread message alerts.
                </p>
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