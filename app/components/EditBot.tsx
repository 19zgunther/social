"use client";

import { useEffect, useState, type MutableRefObject } from "react";
import {
  AddIcon,
  ChevronRightIcon,
  DeleteIcon,
  RefreshIcon,
  RssIcon,
  UserPlaceholderIcon,
} from "@/app/components/Icons";
import ProfilePictureEditor from "@/app/components/ProfilePictureEditor";
import BackButton from "@/app/components/utils/BackButton";
import { useSwipeBackOverride } from "@/app/components/utils/useSwipeBack";
import {
  BotDetail,
  BotLogDetail,
  BotLogGetResponse,
  BotLogListItem,
  BotLogsListResponse,
  BotGetResponse,
  BotUpdateResponse,
  BotWakePeriod,
  BotWakeResponse,
} from "@/app/types/interfaces";

type EditBotProps = {
  botId: string;
  onBack: () => void;
  swipeBackOverrideRef: MutableRefObject<(() => void) | null>;
};

type EditView = "config" | "log" | "rss";

type TranscriptMessage = {
  role?: string;
  content?: unknown;
  tool_calls?: Array<{
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
  tool_call_id?: string;
  name?: string;
};

async function readErrorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
  };
  return body.error?.message ?? "Request failed.";
}

function formatDate(iso: string | null): string {
  if (!iso) {
    return "—";
  }
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function stringifyContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (content == null) {
    return "";
  }
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}

export default function EditBot({
  botId,
  onBack,
  swipeBackOverrideRef,
}: EditBotProps) {
  const [view, setView] = useState<EditView>("config");
  const [bot, setBot] = useState<BotDetail | null>(null);
  const [username, setUsername] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [wakePeriod, setWakePeriod] = useState<BotWakePeriod>("24h");
  const [rssFeeds, setRssFeeds] = useState<string[]>([""]);
  const [logs, setLogs] = useState<BotLogListItem[]>([]);
  const [selectedLog, setSelectedLog] = useState<BotLogDetail | null>(null);
  const [expandedToolIds, setExpandedToolIds] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isWaking, setIsWaking] = useState(false);
  const [isLoadingLog, setIsLoadingLog] = useState(false);
  const [isPictureEditorOpen, setIsPictureEditorOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const onBackFromNested = () => {
    if (view === "log") {
      setView("config");
      setSelectedLog(null);
      setExpandedToolIds({});
      return;
    }
    if (view === "rss") {
      setView("config");
      return;
    }
    onBack();
  };

  const configuredFeedCount = rssFeeds.filter((feed) => feed.trim().length > 0).length;

  useSwipeBackOverride(swipeBackOverrideRef, onBackFromNested, true);

  const loadBot = async () => {
    const response = await fetch("/api/bot-get", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bot_id: botId }),
    });
    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }
    const payload = (await response.json()) as BotGetResponse;
    setBot(payload.bot);
    setUsername(payload.bot.username);
    setSystemPrompt(payload.bot.system_prompt);
    setWakePeriod(payload.bot.wake_period);
    setRssFeeds(payload.bot.rss_feeds.length > 0 ? payload.bot.rss_feeds : [""]);
  };

  const loadLogs = async () => {
    const response = await fetch("/api/bot-logs-list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bot_id: botId }),
    });
    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }
    const payload = (await response.json()) as BotLogsListResponse;
    setLogs(payload.logs);
  };

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      setStatusMessage("");
      try {
        await loadBot();
        await loadLogs();
      } catch (error) {
        if (!cancelled) {
          setStatusMessage(error instanceof Error ? error.message : "Failed to load bot.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [botId]);

  const onSave = async () => {
    if (isSaving) {
      return;
    }
    setIsSaving(true);
    setStatusMessage("");
    try {
      const cleanedFeeds = rssFeeds.map((feed) => feed.trim()).filter((feed) => feed.length > 0);
      const response = await fetch("/api/bot-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bot_id: botId,
          username: username.trim(),
          system_prompt: systemPrompt,
          wake_period: wakePeriod,
          rss_feeds: cleanedFeeds,
        }),
      });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }
      const payload = (await response.json()) as BotUpdateResponse;
      setBot(payload.bot);
      setUsername(payload.bot.username);
      setSystemPrompt(payload.bot.system_prompt);
      setWakePeriod(payload.bot.wake_period);
      setRssFeeds(payload.bot.rss_feeds.length > 0 ? payload.bot.rss_feeds : [""]);
      setStatusMessage("Bot saved.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to save bot.");
    } finally {
      setIsSaving(false);
    }
  };

  const onWakeNow = async () => {
    if (isWaking) {
      return;
    }
    setIsWaking(true);
    setStatusMessage("Waking bot…");
    try {
      const response = await fetch("/api/bot-wake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bot_id: botId }),
      });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }
      const payload = (await response.json()) as BotWakeResponse;
      await loadBot();
      await loadLogs();
      if (payload.status === "failed") {
        setStatusMessage(payload.error ?? "Wake finished with errors.");
      } else {
        setStatusMessage("Wake completed.");
      }
      if (payload.log_id) {
        await openLog(payload.log_id);
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to wake bot.");
    } finally {
      setIsWaking(false);
    }
  };

  const openLog = async (logId: string) => {
    setIsLoadingLog(true);
    setStatusMessage("");
    try {
      const response = await fetch("/api/bot-log-get", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ log_id: logId }),
      });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }
      const payload = (await response.json()) as BotLogGetResponse;
      setSelectedLog(payload.log);
      setExpandedToolIds({});
      setView("log");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to load log.");
    } finally {
      setIsLoadingLog(false);
    }
  };

  const headerTitle =
    view === "log"
      ? "Wake log"
      : view === "rss"
        ? "RSS feeds"
        : bot
          ? `@${bot.username}`
          : "Edit bot";

  const transcriptMessages: TranscriptMessage[] = Array.isArray(selectedLog?.messages)
    ? (selectedLog.messages as TranscriptMessage[])
    : [];

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <div className="flex items-center justify-between border-b border-border px-3 py-3">
        <BackButton onBack={onBackFromNested} />
        <h1 className="text-lg font-semibold text-foreground truncate px-2">{headerTitle}</h1>
        <div className="w-20" />
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain touch-pan-y px-4 py-4">
        {isLoading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : null}

        {!isLoading && view === "config" && bot ? (
          <section className="space-y-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsPictureEditorOpen(true)}
                className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full border border-border bg-surface"
                aria-label="Edit bot profile picture"
              >
                {bot.profile_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={bot.profile_image_url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-muted">
                    <UserPlaceholderIcon className="h-8 w-8" />
                  </span>
                )}
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">Profile image</p>
                <p className="text-xs text-muted">Tap to change</p>
              </div>
            </div>

            <label className="block space-y-1">
              <span className="text-xs text-muted">Username</span>
              <input
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="w-full rounded-xl border border-border bg-bg px-4 py-3 text-sm text-foreground outline-none focus:border-accent"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </label>

            <fieldset className="space-y-2">
              <legend className="text-xs text-muted">Wake period</legend>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { value: "24h", label: "24 hours" },
                    { value: "1w", label: "1 week" },
                  ] as const
                ).map((option) => {
                  const selected = wakePeriod === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setWakePeriod(option.value)}
                      className={`rounded-lg border px-3 py-3 text-left text-sm transition ${
                        selected
                          ? "border-accent bg-accent/15 text-foreground"
                          : "border-border bg-surface text-foreground hover:bg-border/30"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted">
                Stored for future auto-wake. Use Wake now to run immediately.
                {bot.last_woke_at
                  ? ` Last woke ${formatDate(bot.last_woke_at)}.`
                  : " Never woken yet."}
              </p>
            </fieldset>

            <label className="block space-y-1">
              <span className="text-xs text-muted">System prompt</span>
              <textarea
                value={systemPrompt}
                onChange={(event) => setSystemPrompt(event.target.value)}
                rows={6}
                className="w-full rounded-xl border border-border bg-bg px-4 py-3 text-sm text-foreground outline-none focus:border-accent"
              />
            </label>

            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-foreground">Resources</h2>
              <button
                type="button"
                onClick={() => setView("rss")}
                className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-4 py-3 text-left text-sm text-foreground hover:bg-border/30 transition"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <RssIcon className="h-4 w-4 shrink-0 text-muted" />
                  <span className="min-w-0">
                    <span className="block font-medium">RSS</span>
                    <span className="block text-xs text-muted">
                      {configuredFeedCount === 0
                        ? "No feeds configured"
                        : configuredFeedCount === 1
                          ? "1 feed"
                          : `${configuredFeedCount} feeds`}
                    </span>
                  </span>
                </span>
                <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted" />
              </button>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  void onSave();
                }}
                disabled={isSaving || isWaking}
                className="flex-1 rounded-xl bg-accent px-4 py-3 text-sm font-medium text-on-accent disabled:opacity-60"
              >
                {isSaving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => {
                  void onWakeNow();
                }}
                disabled={isSaving || isWaking}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm font-medium text-foreground disabled:opacity-60"
              >
                <RefreshIcon className={`h-4 w-4 ${isWaking ? "animate-spin" : ""}`} />
                {isWaking ? "Waking…" : "Wake now"}
              </button>
            </div>

            <div className="space-y-2 pt-2">
              <h2 className="text-sm font-semibold text-foreground">Wake logs</h2>
              {logs.length === 0 ? (
                <p className="text-xs text-muted">No wake sessions yet.</p>
              ) : (
                logs.map((log) => (
                  <button
                    key={log.id}
                    type="button"
                    onClick={() => {
                      void openLog(log.id);
                    }}
                    disabled={isLoadingLog}
                    className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-4 py-3 text-left text-sm text-foreground hover:bg-border/30 transition disabled:opacity-60"
                  >
                    <span className="min-w-0">
                      <span className="block font-medium capitalize">{log.status}</span>
                      <span className="block text-xs text-muted">
                        {formatDate(log.created_at)}
                        {log.error ? ` · ${log.error}` : ""}
                      </span>
                    </span>
                    <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted" />
                  </button>
                ))
              )}
            </div>
          </section>
        ) : null}

        {!isLoading && view === "rss" ? (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted">
                Feed URLs this bot can fetch when woken.
              </p>
              <button
                type="button"
                onClick={() => setRssFeeds((previous) => [...previous, ""])}
                className="inline-flex items-center gap-1 text-xs text-accent"
              >
                <AddIcon className="h-3.5 w-3.5" />
                Add
              </button>
            </div>
            {rssFeeds.map((feed, index) => (
              <div key={`rss-${index}`} className="flex items-center gap-2">
                <input
                  type="url"
                  value={feed}
                  onChange={(event) => {
                    const value = event.target.value;
                    setRssFeeds((previous) =>
                      previous.map((entry, entryIndex) =>
                        entryIndex === index ? value : entry,
                      ),
                    );
                  }}
                  placeholder="https://example.com/feed.xml"
                  className="min-w-0 flex-1 rounded-xl border border-border bg-bg px-4 py-3 text-sm text-foreground outline-none focus:border-accent"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => {
                    setRssFeeds((previous) => {
                      const next = previous.filter((_, entryIndex) => entryIndex !== index);
                      return next.length > 0 ? next : [""];
                    });
                  }}
                  className="rounded-lg border border-border bg-surface p-2 text-muted hover:bg-border/30"
                  aria-label="Remove feed"
                >
                  <DeleteIcon className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => {
                void onSave();
              }}
              disabled={isSaving}
              className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-medium text-on-accent disabled:opacity-60"
            >
              {isSaving ? "Saving…" : "Save feeds"}
            </button>
          </section>
        ) : null}

        {!isLoading && view === "log" && selectedLog ? (
          <section className="space-y-3">
            <div className="rounded-lg border border-border bg-surface px-4 py-3">
              <p className="text-sm font-medium capitalize text-foreground">{selectedLog.status}</p>
              <p className="text-xs text-muted mt-1">
                Started {formatDate(selectedLog.created_at)}
                {selectedLog.finished_at
                  ? ` · Finished ${formatDate(selectedLog.finished_at)}`
                  : ""}
              </p>
              {selectedLog.error ? (
                <p className="text-xs text-danger mt-2">{selectedLog.error}</p>
              ) : null}
            </div>

            {transcriptMessages.map((message, index) => {
              const role = message.role ?? "unknown";
              const toolCalls = message.tool_calls ?? [];
              const contentText = stringifyContent(message.content);
              const key = `msg-${index}`;

              return (
                <div
                  key={key}
                  className="rounded-lg border border-border bg-surface px-3 py-3 space-y-2"
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {role}
                    {message.tool_call_id ? ` · ${message.tool_call_id}` : ""}
                  </p>
                  {contentText ? (
                    <pre className="whitespace-pre-wrap break-words font-mono text-xs text-foreground">
                      {contentText}
                    </pre>
                  ) : null}
                  {toolCalls.map((toolCall, toolIndex) => {
                    const toolKey = `${key}-tool-${toolIndex}`;
                    const expanded = Boolean(expandedToolIds[toolKey]);
                    const name = toolCall.function?.name ?? "tool";
                    const args = toolCall.function?.arguments ?? "";
                    return (
                      <div key={toolKey} className="rounded-md border border-border bg-bg">
                        <button
                          type="button"
                          onClick={() => {
                            setExpandedToolIds((previous) => ({
                              ...previous,
                              [toolKey]: !previous[toolKey],
                            }));
                          }}
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-xs text-foreground"
                        >
                          <span className="font-medium">tool call · {name}</span>
                          <ChevronRightIcon
                            className={`h-3.5 w-3.5 text-muted transition ${expanded ? "rotate-90" : ""}`}
                          />
                        </button>
                        {expanded ? (
                          <pre className="border-t border-border px-3 py-2 whitespace-pre-wrap break-words font-mono text-xs text-muted">
                            {args || "{}"}
                          </pre>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </section>
        ) : null}
      </div>

      {statusMessage ? (
        <div className="border-t border-border px-4 py-3">
          <p className="text-xs text-muted">{statusMessage}</p>
        </div>
      ) : null}

      <ProfilePictureEditor
        isOpen={isPictureEditorOpen}
        onClose={() => setIsPictureEditorOpen(false)}
        setApiPath="/api/bot-profile-image-set"
        removeApiPath="/api/bot-profile-image-remove"
        extraBody={{ bot_id: botId }}
        onSaved={(profileImageId, profileImageUrl) => {
          setBot((previous) =>
            previous
              ? {
                  ...previous,
                  profile_image_id: profileImageId,
                  profile_image_url: profileImageUrl,
                }
              : previous,
          );
          setStatusMessage("Profile image updated.");
        }}
      />
    </div>
  );
}
