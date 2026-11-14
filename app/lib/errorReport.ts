/** Shared error dump formatting + client fire-and-forget reporter (safe in browser bundles). */

export const ERROR_LOG_MESSAGE_MAX = 16_000;

const safeJson = (value: unknown): string => {
  try {
    return JSON.stringify(value, (_key, nested) => {
      if (typeof nested === "bigint") {
        return nested.toString();
      }
      if (nested instanceof Error) {
        return {
          name: nested.name,
          message: nested.message,
          stack: nested.stack,
        };
      }
      return nested;
    }, 2);
  } catch {
    return String(value);
  }
};

const clientEnvDump = (): Record<string, unknown> | null => {
  if (typeof window === "undefined") {
    return null;
  }
  return {
    href: window.location.href,
    userAgent: navigator.userAgent,
    online: navigator.onLine,
    language: navigator.language,
    time: new Date().toISOString(),
  };
};

/** Full message/stack/cause/context dump for error_log.message. */
export function formatErrorDump(
  error: unknown,
  context?: Record<string, unknown>,
): string {
  const parts: string[] = [];

  if (error instanceof Error) {
    parts.push(`${error.name}: ${error.message}`);
    if (error.stack) {
      parts.push(`--- stack ---\n${error.stack}`);
    }
    let cause: unknown = error.cause;
    let depth = 0;
    while (cause !== undefined && cause !== null && depth < 5) {
      if (cause instanceof Error) {
        parts.push(
          `--- cause[${depth}] ---\n${cause.name}: ${cause.message}${cause.stack ? `\n${cause.stack}` : ""}`,
        );
        cause = cause.cause;
      } else {
        parts.push(`--- cause[${depth}] ---\n${safeJson(cause)}`);
        break;
      }
      depth += 1;
    }
  } else if (typeof error === "string") {
    parts.push(error);
  } else {
    parts.push(safeJson(error));
  }

  if (context && Object.keys(context).length > 0) {
    parts.push(`--- context ---\n${safeJson(context)}`);
  }

  const client = clientEnvDump();
  if (client) {
    parts.push(`--- client ---\n${safeJson(client)}`);
  }

  return parts.join("\n\n").slice(0, ERROR_LOG_MESSAGE_MAX);
}

/** Fire-and-forget client report to /api/error-log. Never throws. */
export function reportClientError(
  key: string,
  error: unknown,
  context?: Record<string, unknown>,
): void {
  const message = formatErrorDump(error, context);
  const userName =
    typeof context?.user_name === "string"
      ? context.user_name
      : typeof context?.identifier === "string"
        ? context.identifier
        : undefined;
  void fetch("/api/error-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      key,
      message,
      ...(userName ? { user_name: userName } : {}),
    }),
    keepalive: true,
  }).catch(() => {});
}
