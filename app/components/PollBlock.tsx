"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiError, PollViewerState, PostData } from "@/app/types/interfaces";

type PollBlockProps = {
  postId: string;
  poll: PollViewerState;
  isPreview?: boolean;
  onPollUpdated?: (data: PostData) => void;
};

const isPollViewerState = (value: unknown): value is PollViewerState => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.has_voted === "boolean" &&
    typeof record.is_closed === "boolean" &&
    typeof record.closes_at === "string" &&
    Array.isArray(record.options)
  );
};

export const getPollViewerState = (data: PostData | null | undefined): PollViewerState | null => {
  if (!data?.poll || !isPollViewerState(data.poll)) {
    return null;
  }
  return data.poll;
};

const formatPollStatus = (poll: PollViewerState): string => {
  if (poll.is_closed) {
    return "Poll closed";
  }
  const closesAtMs = Date.parse(poll.closes_at);
  if (Number.isNaN(closesAtMs)) {
    return "Poll open";
  }
  const remainingMs = closesAtMs - Date.now();
  if (remainingMs <= 0) {
    return "Poll closed";
  }
  const hours = Math.ceil(remainingMs / (60 * 60 * 1000));
  if (hours < 24) {
    return `${hours}h left`;
  }
  const days = Math.ceil(hours / 24);
  return `${days}d left`;
};

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as ApiError;
    return body.error?.message ?? "Failed to submit vote.";
  } catch {
    return "Failed to submit vote.";
  }
};

export default function PollBlock({
  postId,
  poll,
  isPreview = false,
  onPollUpdated,
}: PollBlockProps) {
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>(poll.viewer_selection);
  const [isChangingVote, setIsChangingVote] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    setSelectedOptionIds(poll.viewer_selection);
    setIsChangingVote(false);
    setStatusMessage("");
  }, [poll]);

  const showVotingUi =
    !isPreview && !poll.is_closed && (!poll.has_voted || isChangingVote);
  const showResults = !showVotingUi && (poll.has_voted || poll.is_closed || poll.results !== null);
  const canChangeVote =
    !isPreview &&
    poll.has_voted &&
    poll.allow_vote_changes &&
    !poll.is_closed &&
    !isChangingVote;
  const canAuthorOrViewerStartVote =
    !isPreview && !poll.is_closed && !poll.has_voted && !isChangingVote && poll.results !== null;

  const maxResultCount = useMemo(() => {
    if (!poll.results?.length) {
      return 0;
    }
    return Math.max(...poll.results.map((row) => row.count), 0);
  }, [poll.results]);

  const toggleOption = (optionId: string) => {
    if (!showVotingUi) {
      return;
    }
    setSelectedOptionIds((previous) => {
      if (poll.selection_mode === "single") {
        return [optionId];
      }
      if (previous.includes(optionId)) {
        return previous.filter((id) => id !== optionId);
      }
      return [...previous, optionId];
    });
  };

  const onSubmitVote = async () => {
    if (isPreview || isSubmitting || selectedOptionIds.length === 0) {
      return;
    }
    setIsSubmitting(true);
    setStatusMessage("");
    try {
      const response = await fetch("/api/feed-post-vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          post_id: postId,
          option_ids: selectedOptionIds,
        }),
      });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }
      const payload = (await response.json()) as { data?: PostData | null };
      if (payload.data) {
        onPollUpdated?.(payload.data);
      }
      setIsChangingVote(false);
    } catch {
      setStatusMessage("Failed to submit vote.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-accent-2">
          {poll.selection_mode === "single" ? "Poll · pick one" : "Poll · pick any"}
        </p>
        <p className="text-xs text-accent-2">{formatPollStatus(poll)}</p>
      </div>

      <div className="space-y-2">
        {poll.options.map((option) => {
          const isSelected = selectedOptionIds.includes(option.id);
          const resultCount =
            poll.results?.find((row) => row.option_id === option.id)?.count ?? 0;
          const percentage =
            showResults && poll.total_voters && poll.total_voters > 0
              ? Math.round((resultCount / poll.total_voters) * 100)
              : showResults && maxResultCount > 0
                ? Math.round((resultCount / maxResultCount) * 100)
                : 0;
          const wasViewerChoice = poll.viewer_selection.includes(option.id);

          if (showResults) {
            return (
              <div
                key={option.id}
                className={`relative overflow-hidden rounded-lg border px-3 py-2 ${
                  wasViewerChoice ? "border-accent-3" : "border-accent-1"
                }`}
              >
                <div
                  className="absolute inset-y-0 left-0 bg-accent-3/20"
                  style={{ width: `${percentage}%` }}
                />
                <div className="relative flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 break-words text-foreground">{option.text}</span>
                  <span className="shrink-0 tabular-nums text-accent-2">
                    {resultCount}
                    {poll.total_voters != null ? ` · ${percentage}%` : ""}
                  </span>
                </div>
              </div>
            );
          }

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => toggleOption(option.id)}
              disabled={!showVotingUi}
              className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${
                isSelected
                  ? "border-accent-3 bg-accent-3/15 text-foreground"
                  : "border-accent-1 bg-secondary-background text-foreground"
              } disabled:opacity-60`}
            >
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center border ${
                  poll.selection_mode === "single" ? "rounded-full" : "rounded-sm"
                } ${isSelected ? "border-accent-3 bg-accent-3" : "border-accent-2"}`}
              >
                {isSelected ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-primary-background" />
                ) : null}
              </span>
              <span className="min-w-0 break-words">{option.text}</span>
            </button>
          );
        })}
      </div>

      {showResults && poll.total_voters != null ? (
        <p className="text-xs text-accent-2">
          {poll.total_voters} vote{poll.total_voters === 1 ? "" : "s"}
        </p>
      ) : null}

      {showVotingUi ? (
        <button
          type="button"
          onClick={() => {
            void onSubmitVote();
          }}
          disabled={isSubmitting || selectedOptionIds.length === 0}
          className="rounded-lg bg-accent-3 px-3 py-2 text-sm font-semibold text-primary-background disabled:opacity-50"
        >
          {isSubmitting ? "Submitting..." : isChangingVote ? "Update vote" : "Vote"}
        </button>
      ) : null}

      {canChangeVote ? (
        <button
          type="button"
          onClick={() => {
            setSelectedOptionIds(poll.viewer_selection);
            setIsChangingVote(true);
            setStatusMessage("");
          }}
          className="text-sm font-semibold text-accent-3 hover:brightness-110"
        >
          Change vote
        </button>
      ) : null}

      {canAuthorOrViewerStartVote ? (
        <button
          type="button"
          onClick={() => {
            setSelectedOptionIds([]);
            setIsChangingVote(true);
            setStatusMessage("");
          }}
          className="text-sm font-semibold text-accent-3 hover:brightness-110"
        >
          Cast a vote
        </button>
      ) : null}

      {isChangingVote ? (
        <button
          type="button"
          onClick={() => {
            setSelectedOptionIds(poll.viewer_selection);
            setIsChangingVote(false);
            setStatusMessage("");
          }}
          className="ml-3 text-sm text-accent-2 hover:text-foreground"
        >
          Cancel
        </button>
      ) : null}

      {statusMessage ? <p className="text-xs text-accent-2">{statusMessage}</p> : null}
    </div>
  );
}
