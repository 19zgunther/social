import { sendPushToUsers } from "@/app/lib/push_notifications";

/** User IDs that receive developer alerts and can use the Dev Account Switcher. Server-only. */
export const DEVELOPER_USER_IDS = [
  "3df596f3-a0b6-44b4-af39-a3688c78edd9",
  "4c49d560-37ca-47e6-8a4a-cc3bf3501a5c",
  "74fc2cb5-3df2-4309-8d8a-3c881add7114",
  "a065ba62-4929-4ab4-97eb-7b61b1a514ad",
  "d5fe194e-e836-42c6-9d06-8c2d4f879bbd",
] as const;

export function isDeveloperUserId(userId: string): boolean {
  return (DEVELOPER_USER_IDS as readonly string[]).includes(userId);
}

/** Fire-and-forget push to all developers (optionally excluding one user). */
export const notifyDevelopers = (input: {
  title: string;
  body: string;
  url?: string;
  excludeUserId?: string;
}): void => {
  const recipientUserIds = DEVELOPER_USER_IDS.filter(
    (userId) => userId !== input.excludeUserId,
  );
  if (recipientUserIds.length === 0) {
    return;
  }

  void sendPushToUsers({
    recipientUserIds: [...recipientUserIds],
    payload: {
      title: input.title,
      body: input.body,
      ...(input.url ? { url: input.url } : {}),
    },
  }).catch((error) => {
    console.error("notify_developers_push_failed", error);
  });
};
