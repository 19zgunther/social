import webpush, { PushSubscription } from "web-push";
import { prisma } from "@/app/lib/prisma";

type PushPayload = {
  title: string;
  body: string;
  url?: string;
  thread_id?: string;
};

let vapidConfigured = false;

const ensureVapidConfigured = (): void => {
  if (vapidConfigured) {
    return;
  }

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    throw new Error("VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT are required.");
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
};

export const getPublicVapidKey = (): string => {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) {
    throw new Error("VAPID_PUBLIC_KEY is not configured.");
  }
  return publicKey;
};

export const sendPushToUsers = async (input: {
  recipientUserIds: string[];
  payload: PushPayload;
}): Promise<void> => {
  if (input.recipientUserIds.length === 0) {
    return;
  }

  ensureVapidConfigured();

  const subscriptions = await prisma.push_subscriptions.findMany({
    where: {
      user_id: {
        in: input.recipientUserIds,
      },
      is_active: true,
    },
    select: {
      id: true,
      endpoint: true,
      p256dh: true,
      auth: true,
    },
  });

  if (subscriptions.length === 0) {
    return;
  }

  const payload = JSON.stringify(input.payload);
  await Promise.all(
    subscriptions.map(async (subscriptionRow) => {
      if (!subscriptionRow.p256dh || !subscriptionRow.auth) {
        return;
      }

      const pushSubscription: PushSubscription = {
        endpoint: subscriptionRow.endpoint,
        expirationTime: null,
        keys: {
          p256dh: subscriptionRow.p256dh,
          auth: subscriptionRow.auth,
        },
      };

      try {
        await webpush.sendNotification(pushSubscription, payload);
      } catch (error) {
        const statusCode =
          typeof error === "object" && error !== null && "statusCode" in error
            ? Number((error as { statusCode?: number }).statusCode)
            : undefined;

        if (statusCode === 404 || statusCode === 410) {
          await prisma.push_subscriptions.updateMany({
            where: {
              id: subscriptionRow.id,
            },
            data: {
              is_active: false,
              updated_at: new Date(),
            },
          });
        } else {
          console.error("push_send_failed", subscriptionRow.id, error);
        }
      }
    }),
  );
};
