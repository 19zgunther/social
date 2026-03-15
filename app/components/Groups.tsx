"use client";

import { FormEvent, useEffect, useState } from "react";
import Thread, { ThreadItem } from "@/app/components/Thread";

type GroupsProps = {
  currentUserId: string;
};

type ApiError = {
  error?: {
    code?: string;
    message?: string;
  };
};

const AUTH_TOKEN_KEY = "auth_token";

const postWithAuth = async (path: string, body: unknown): Promise<Response> => {
  const token = window.localStorage.getItem(AUTH_TOKEN_KEY);
  if (!token) {
    throw new Error("Not authenticated.");
  }

  return fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
};

export default function Groups({ currentUserId }: GroupsProps) {
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [selectedThread, setSelectedThread] = useState<ThreadItem | null>(null);
  const [threadName, setThreadName] = useState("");
  const [isLoadingThreads, setIsLoadingThreads] = useState(true);
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const readErrorMessage = async (response: Response): Promise<string> => {
    try {
      const body = (await response.json()) as ApiError;
      return body.error?.message ?? "Request failed.";
    } catch {
      return "Request failed.";
    }
  };

  useEffect(() => {
    const run = async () => {
      setIsLoadingThreads(true);
      setStatusMessage("");

      try {
        const response = await postWithAuth("/api/groups-list", {});
        if (!response.ok) {
          setStatusMessage(await readErrorMessage(response));
          setThreads([]);
          return;
        }

        const payload = (await response.json()) as { threads: ThreadItem[] };
        setThreads(payload.threads);
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : "Failed to load groups.");
        setThreads([]);
      } finally {
        setIsLoadingThreads(false);
      }
    };

    void run();
  }, []);

  const onCreateThread = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!threadName.trim()) {
      return;
    }

    setIsCreatingThread(true);
    setStatusMessage("");

    try {
      const response = await postWithAuth("/api/thread-create", { name: threadName });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }

      const payload = (await response.json()) as { thread: ThreadItem };
      setThreads((previous) => [payload.thread, ...previous]);
      setThreadName("");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to create thread.");
    } finally {
      setIsCreatingThread(false);
    }
  };

  if (selectedThread) {
    return (
      <Thread
        thread={selectedThread}
        currentUserId={currentUserId}
        onBack={() => {
          setSelectedThread(null);
          setStatusMessage("");
        }}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col space-y-3 px-2">
      <div>
        <header className="flex items-center justify-between border-b border-accent-1 px-4 py-3">
          <h1 className="text-lg font-semibold text-foreground">Groups</h1>
        </header>
      </div>

      <form onSubmit={onCreateThread} className="flex items-center gap-2">
        <input
          className="flex-1 rounded-xl border border-accent-1 bg-primary-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent-2"
          placeholder="New thread name"
          value={threadName}
          onChange={(event) => setThreadName(event.target.value)}
          required
        />
        <button
          type="submit"
          disabled={isCreatingThread}
          className="rounded-xl bg-accent-3 px-4 py-2 text-xs font-semibold text-primary-background transition hover:brightness-110 disabled:opacity-60"
        >
          {isCreatingThread ? "Creating..." : "Create"}
        </button>
      </form>

      <div className="flex-1 min-h-0 space-y-2 overflow-y-auto overscroll-contain pr-1 touch-pan-y">
        {isLoadingThreads ? (
          <div className="flex items-center gap-2 rounded-xl border border-accent-1 bg-primary-background px-3 py-2">
            <span
              aria-hidden
              className="h-3 w-3 animate-spin rounded-full border-2 border-accent-2 border-t-transparent"
            />
            <p className="text-xs text-accent-2">Loading threads...</p>
          </div>
        ) : null}

        {!isLoadingThreads && threads.length === 0 ? (
          <p className="text-xs text-accent-2">No threads yet. Create your first one.</p>
        ) : null}

        {threads.map((thread) => (
          <button
            key={thread.id}
            type="button"
            onClick={() => {
              setSelectedThread(thread);
            }}
            className="w-full rounded-xl border border-accent-1 bg-primary-background px-4 py-3 text-left transition hover:border-accent-2"
          >
            <p className="text-sm font-medium text-foreground">{thread.name}</p>
            <p className="mt-1 text-xs text-accent-2">Owner: {thread.owner_username}</p>
          </button>
        ))}
      </div>

      {statusMessage ? <p className="text-xs text-accent-2">{statusMessage}</p> : null}
    </div>
  );
}
