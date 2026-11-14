import { ERROR_LOG_MESSAGE_MAX, formatErrorDump } from "@/app/lib/errorReport";
import { prisma } from "@/app/lib/prisma";

const ERROR_LOG_KEY_MAX = 120;

export type LogErrorInput = {
  userId: string | null;
  userName: string;
  key: string;
  message: string;
};

/** Inserts a row into error_log. Never throws — safe to fire-and-forget. */
export async function logError(input: LogErrorInput): Promise<void> {
  const key = input.key.trim().slice(0, ERROR_LOG_KEY_MAX);
  const message = input.message.trim().slice(0, ERROR_LOG_MESSAGE_MAX);
  const userName = (input.userName.trim() || "anonymous").slice(0, 200);
  if (!key || !message) {
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

/** Convenience: dump stack/context then insert. Never throws. */
export async function logErrorDump(input: {
  userId: string | null;
  userName: string;
  key: string;
  error: unknown;
  context?: Record<string, unknown>;
}): Promise<void> {
  await logError({
    userId: input.userId,
    userName: input.userName,
    key: input.key,
    message: formatErrorDump(input.error, input.context),
  });
}
