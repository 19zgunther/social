import { prisma } from "@/app/lib/prisma";

const ERROR_LOG_KEY_MAX = 120;
const ERROR_LOG_MESSAGE_MAX = 4000;

export type LogErrorInput = {
  userId: string;
  userName: string;
  key: string;
  message: string;
};

/** Inserts a row into error_log. Never throws — safe to fire-and-forget. */
export async function logError(input: LogErrorInput): Promise<void> {
  const key = input.key.trim().slice(0, ERROR_LOG_KEY_MAX);
  const message = input.message.trim().slice(0, ERROR_LOG_MESSAGE_MAX);
  const userName = input.userName.trim().slice(0, 200);
  if (!input.userId || !userName || !key || !message) {
    return;
  }

  try {
    await prisma.error_log.create({
      data: {
        user_id: input.userId,
        user_name: userName,
        key,
        message,
      },
    });
  } catch (error) {
    console.error("error_log_insert_failed", key, error);
  }
}
