"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, LoaderCircle, RefreshCw, Square, Trash2 } from "lucide-react";
import { ApiError } from "@/app/types/interfaces";

export type FeedbackItem = {
  id: string;
  created_at: string;
  created_by: string;
  text: string;
  status: "resolved" | "unresolved";
  username: string;
};

const postWithAuth = async (path: string, body: unknown): Promise<Response> =>
  fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as ApiError;
    return body.error?.message ?? "Request failed.";
  } catch {
    return "Request failed.";
  }
};

export default function Feedback({
  currentUserId,
  isActive,
}: {
  currentUserId: string;
  isActive: boolean;
}) {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [draft, setDraft] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async (opts?: { refresh?: boolean }) => {
    const refresh = opts?.refresh ?? false;
    if (refresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setStatusMessage("");
    try {
      const response = await postWithAuth("/api/feedback-list", {});
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }
      const payload = (await response.json()) as { items?: FeedbackItem[] };
      setItems(payload.items ?? []);
    } catch (e) {
      setStatusMessage(e instanceof Error ? e.message : "Failed to load feedback.");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (isActive) {
      void load();
    }
  }, [isActive, load]);

  const onSubmit = async () => {
    const text = draft.trim();
    if (!text || isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    setStatusMessage("");
    try {
      const response = await postWithAuth("/api/feedback-create", { text });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }
      const payload = (await response.json()) as { item?: FeedbackItem };
      if (payload.item) {
        setItems((prev) => [payload.item!, ...prev]);
      }
      setDraft("");
    } catch (e) {
      setStatusMessage(e instanceof Error ? e.message : "Failed to submit.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleStatus = async (item: FeedbackItem) => {
    const next = item.status === "resolved" ? "unresolved" : "resolved";
    setPendingId(item.id);
    setStatusMessage("");
    try {
      const response = await postWithAuth("/api/feedback-status", {
        feedback_id: item.id,
        status: next,
      });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }
      const payload = (await response.json()) as { item?: FeedbackItem };
      if (payload.item) {
        setItems((prev) => prev.map((r) => (r.id === item.id ? payload.item! : r)));
      }
    } catch (e) {
      setStatusMessage(e instanceof Error ? e.message : "Failed to update status.");
    } finally {
      setPendingId(null);
    }
  };

  const onDelete = async (item: FeedbackItem) => {
    if (item.created_by !== currentUserId) {
      return;
    }
    setPendingId(item.id);
    setStatusMessage("");
    try {
      const response = await postWithAuth("/api/feedback-delete", { feedback_id: item.id });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }
      setItems((prev) => prev.filter((r) => r.id !== item.id));
    } catch (e) {
      setStatusMessage(e instanceof Error ? e.message : "Failed to delete.");
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-primary-background">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-accent-1 px-4 py-3">
        <h1 className="text-lg font-semibold text-foreground">Feedback</h1>
        <button
          type="button"
          onClick={() => void load({ refresh: true })}
          disabled={isRefreshing || isLoading}
          className="flex items-center gap-1.5 rounded-md border border-accent-1 px-2.5 py-1.5 text-sm text-accent-2 transition hover:border-accent-3 hover:text-accent-3 disabled:opacity-50"
          aria-label="Refresh feedback"
        >
          {isRefreshing ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="h-4 w-4" aria-hidden />
          )}
          Refresh
        </button>
      </header>

      <div className="shrink-0 border-b border-accent-1 p-4">
        <label htmlFor="feedback-draft" className="sr-only">
          New bug report or message
        </label>
        <textarea
          id="feedback-draft"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Describe a bug, idea, or message for everyone…"
          rows={3}
          className="w-full resize-none rounded-md border border-accent-1 bg-secondary-background px-3 py-2 text-sm text-foreground placeholder:text-accent-2 focus:border-accent-3 focus:outline-none"
        />
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={() => void onSubmit()}
            disabled={!draft.trim() || isSubmitting}
            className="rounded-md bg-accent-3 px-4 py-2 text-sm font-medium text-primary-background transition hover:opacity-90 disabled:opacity-40"
          >
            {isSubmitting ? "Sending…" : "Submit"}
          </button>
        </div>
      </div>

      {statusMessage ? (
        <p className="shrink-0 px-4 py-2 text-center text-sm text-red-400">{statusMessage}</p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {isLoading && !isRefreshing ? (
          <div className="flex justify-center py-12">
            <LoaderCircle className="h-8 w-8 animate-spin text-accent-2" aria-hidden />
          </div>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-accent-2">No feedback yet. Be the first to post.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((item) => {
              const isResolved = item.status === "resolved";
              const busy = pendingId === item.id;
              const canDelete = item.created_by === currentUserId;
              return (
                <li
                  key={item.id}
                  className="rounded-lg border border-accent-1 bg-secondary-background p-3"
                >
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() => void toggleStatus(item)}
                      disabled={busy}
                      title={isResolved ? "Mark unresolved" : "Mark resolved"}
                      className="shrink-0 rounded-md p-2 transition hover:bg-primary-background disabled:opacity-40"
                      aria-label={isResolved ? "Mark unresolved" : "Mark resolved"}
                    >
                      {busy ? (
                        <LoaderCircle className="h-5 w-5 animate-spin text-accent-2" aria-hidden />
                      ) : isResolved ? (
                        <Check className="h-5 w-5 text-green-500" aria-hidden strokeWidth={2.5} />
                      ) : (
                        <Square className="h-5 w-5 fill-orange-500/25 text-orange-500" aria-hidden strokeWidth={2} />
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-accent-2">
                        <span className="font-medium text-foreground">{item.username}</span>
                        <span aria-hidden>·</span>
                        <time dateTime={item.created_at}>
                          {new Date(item.created_at).toLocaleString()}
                        </time>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{item.text}</p>
                    </div>
                    {canDelete ? (
                      <button
                        type="button"
                        onClick={() => void onDelete(item)}
                        disabled={busy}
                        title="Delete"
                        className="shrink-0 rounded-md p-2 text-accent-2 transition hover:bg-primary-background hover:text-red-400 disabled:opacity-40"
                        aria-label="Delete feedback"
                      >
                        <Trash2 className="h-5 w-5" aria-hidden />
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
