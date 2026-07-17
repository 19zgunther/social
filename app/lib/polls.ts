import { randomUUID } from "node:crypto";
import {
  PollCreateInput,
  PollData,
  PollDurationHours,
  PollOption,
  PollResultRow,
  PollSelectionMode,
  PollViewerState,
  PostData,
} from "@/app/types/interfaces";

const POLL_DURATION_HOURS: ReadonlySet<number> = new Set([12, 24, 48, 168]);
const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 10;
const MAX_OPTION_TEXT_LENGTH = 200;

export type PollValidationError = {
  code: string;
  message: string;
};

const isPollSelectionMode = (value: unknown): value is PollSelectionMode =>
  value === "single" || value === "multiple";

const isPollDurationHours = (value: unknown): value is PollDurationHours =>
  typeof value === "number" && POLL_DURATION_HOURS.has(value);

export const isPollClosed = (poll: Pick<PollData, "closes_at">, now: Date = new Date()): boolean => {
  const closesAtMs = Date.parse(poll.closes_at);
  if (Number.isNaN(closesAtMs)) {
    return true;
  }
  return now.getTime() >= closesAtMs;
};

export const parsePollData = (value: unknown): PollData | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.options) || raw.options.length < MIN_OPTIONS || raw.options.length > MAX_OPTIONS) {
    return null;
  }
  if (!isPollSelectionMode(raw.selection_mode)) {
    return null;
  }
  if (typeof raw.allow_vote_changes !== "boolean") {
    return null;
  }
  if (typeof raw.closes_at !== "string" || Number.isNaN(Date.parse(raw.closes_at))) {
    return null;
  }

  const options: PollOption[] = [];
  for (const option of raw.options) {
    if (!option || typeof option !== "object" || Array.isArray(option)) {
      return null;
    }
    const optionRecord = option as Record<string, unknown>;
    if (typeof optionRecord.id !== "string" || !optionRecord.id.trim()) {
      return null;
    }
    if (typeof optionRecord.text !== "string" || !optionRecord.text.trim()) {
      return null;
    }
    options.push({ id: optionRecord.id.trim(), text: optionRecord.text.trim() });
  }

  const votes: Record<string, string[]> = {};
  if (raw.votes && typeof raw.votes === "object" && !Array.isArray(raw.votes)) {
    for (const [userId, selection] of Object.entries(raw.votes as Record<string, unknown>)) {
      if (!Array.isArray(selection)) {
        continue;
      }
      const optionIds = selection.filter((id): id is string => typeof id === "string" && id.length > 0);
      if (optionIds.length > 0) {
        votes[userId] = optionIds;
      }
    }
  }

  return {
    options,
    selection_mode: raw.selection_mode,
    allow_vote_changes: raw.allow_vote_changes,
    closes_at: raw.closes_at,
    votes,
  };
};

export const parsePollCreateInput = (value: unknown): PollCreateInput | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.options)) {
    return null;
  }
  if (!isPollSelectionMode(raw.selection_mode)) {
    return null;
  }
  if (typeof raw.allow_vote_changes !== "boolean") {
    return null;
  }
  if (!isPollDurationHours(raw.duration_hours)) {
    return null;
  }

  const options: Array<{ text: string }> = [];
  for (const option of raw.options) {
    if (!option || typeof option !== "object" || Array.isArray(option)) {
      return null;
    }
    const optionRecord = option as Record<string, unknown>;
    if (typeof optionRecord.text !== "string") {
      return null;
    }
    options.push({ text: optionRecord.text });
  }

  return {
    options,
    selection_mode: raw.selection_mode,
    allow_vote_changes: raw.allow_vote_changes,
    duration_hours: raw.duration_hours,
  };
};

export const validateAndBuildPoll = (
  input: PollCreateInput,
  now: Date = new Date(),
): { poll: PollData } | { error: PollValidationError } => {
  const trimmedOptions = input.options
    .map((option) => option.text.trim())
    .filter((text) => text.length > 0);

  if (trimmedOptions.length < MIN_OPTIONS) {
    return {
      error: {
        code: "invalid_poll",
        message: `Polls require at least ${MIN_OPTIONS} options.`,
      },
    };
  }
  if (trimmedOptions.length > MAX_OPTIONS) {
    return {
      error: {
        code: "invalid_poll",
        message: `Polls allow at most ${MAX_OPTIONS} options.`,
      },
    };
  }
  if (trimmedOptions.some((text) => text.length > MAX_OPTION_TEXT_LENGTH)) {
    return {
      error: {
        code: "invalid_poll",
        message: `Each option must be at most ${MAX_OPTION_TEXT_LENGTH} characters.`,
      },
    };
  }
  if (!isPollSelectionMode(input.selection_mode)) {
    return {
      error: {
        code: "invalid_poll",
        message: "selection_mode must be single or multiple.",
      },
    };
  }
  if (!isPollDurationHours(input.duration_hours)) {
    return {
      error: {
        code: "invalid_poll",
        message: "duration_hours must be 12, 24, 48, or 168.",
      },
    };
  }

  const closesAt = new Date(now.getTime() + input.duration_hours * 60 * 60 * 1000);
  return {
    poll: {
      options: trimmedOptions.map((text) => ({ id: randomUUID(), text })),
      selection_mode: input.selection_mode,
      allow_vote_changes: Boolean(input.allow_vote_changes),
      closes_at: closesAt.toISOString(),
      votes: {},
    },
  };
};

const buildResults = (poll: PollData): { results: PollResultRow[]; totalVoters: number } => {
  const counts = new Map<string, number>(poll.options.map((option) => [option.id, 0]));
  let totalVoters = 0;
  for (const selection of Object.values(poll.votes)) {
    if (!Array.isArray(selection) || selection.length === 0) {
      continue;
    }
    totalVoters += 1;
    for (const optionId of selection) {
      if (counts.has(optionId)) {
        counts.set(optionId, (counts.get(optionId) ?? 0) + 1);
      }
    }
  }
  return {
    results: poll.options.map((option) => ({
      option_id: option.id,
      count: counts.get(option.id) ?? 0,
    })),
    totalVoters,
  };
};

export type PollVoterBreakdownRow = {
  option_id: string;
  text: string;
  voter_ids: string[];
};

/** Invert votes into per-option voter ids (option order preserved; unknown option ids skipped). */
export const buildClosedPollVoterBreakdown = (poll: PollData): PollVoterBreakdownRow[] => {
  const validOptionIds = new Set(poll.options.map((option) => option.id));
  const votersByOption = new Map<string, string[]>(poll.options.map((option) => [option.id, []]));

  for (const [userId, selection] of Object.entries(poll.votes)) {
    if (!userId || !Array.isArray(selection) || selection.length === 0) {
      continue;
    }
    const seenForUser = new Set<string>();
    for (const optionId of selection) {
      if (!validOptionIds.has(optionId) || seenForUser.has(optionId)) {
        continue;
      }
      seenForUser.add(optionId);
      votersByOption.get(optionId)?.push(userId);
    }
  }

  return poll.options.map((option) => ({
    option_id: option.id,
    text: option.text,
    voter_ids: votersByOption.get(option.id) ?? [],
  }));
};

export const sanitizePollForViewer = ({
  poll,
  viewerUserId,
  authorUserId,
  now = new Date(),
}: {
  poll: PollData;
  viewerUserId: string;
  authorUserId: string;
  now?: Date;
}): PollViewerState => {
  const isClosed = isPollClosed(poll, now);
  const viewerSelection = poll.votes[viewerUserId] ?? [];
  const hasVoted = viewerSelection.length > 0;
  const canSeeResults = hasVoted || isClosed || viewerUserId === authorUserId;
  const { results, totalVoters } = buildResults(poll);

  return {
    options: poll.options.map((option) => ({ id: option.id, text: option.text })),
    selection_mode: poll.selection_mode,
    allow_vote_changes: poll.allow_vote_changes,
    closes_at: poll.closes_at,
    has_voted: hasVoted,
    viewer_selection: viewerSelection,
    is_closed: isClosed,
    results: canSeeResults ? results : null,
    total_voters: canSeeResults ? totalVoters : null,
  };
};

export const sanitizePostDataForViewer = ({
  data,
  viewerUserId,
  authorUserId,
  now = new Date(),
}: {
  data: unknown;
  viewerUserId: string;
  authorUserId: string;
  now?: Date;
}): PostData | null => {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }
  const dataObject = { ...(data as PostData) };
  const storedPoll = parsePollData(dataObject.poll);
  if (!storedPoll) {
    if (dataObject.poll !== undefined) {
      delete dataObject.poll;
    }
    return dataObject;
  }
  dataObject.poll = sanitizePollForViewer({
    poll: storedPoll,
    viewerUserId,
    authorUserId,
    now,
  });
  return dataObject;
};

export const applyVote = ({
  poll,
  userId,
  optionIds,
  now = new Date(),
}: {
  poll: PollData;
  userId: string;
  optionIds: string[];
  now?: Date;
}): { poll: PollData } | { error: PollValidationError } => {
  if (optionIds.length > MAX_OPTIONS) {
    return {
      error: {
        code: "invalid_vote",
        message: `Select at most ${MAX_OPTIONS} options.`,
      },
    };
  }

  if (isPollClosed(poll, now)) {
    return {
      error: {
        code: "poll_closed",
        message: "This poll has closed.",
      },
    };
  }

  const hasExistingVote = Boolean(poll.votes[userId]?.length);
  if (hasExistingVote && !poll.allow_vote_changes) {
    return {
      error: {
        code: "vote_locked",
        message: "You already voted and vote changes are not allowed.",
      },
    };
  }

  const uniqueOptionIds = Array.from(
    new Set(
      optionIds
        .filter((id): id is string => typeof id === "string")
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    ),
  );
  if (uniqueOptionIds.length === 0) {
    return {
      error: {
        code: "invalid_vote",
        message: "Select at least one option.",
      },
    };
  }

  const validOptionIds = new Set(poll.options.map((option) => option.id));
  if (uniqueOptionIds.some((optionId) => !validOptionIds.has(optionId))) {
    return {
      error: {
        code: "invalid_vote",
        message: "One or more selected options are invalid.",
      },
    };
  }

  if (poll.selection_mode === "single" && uniqueOptionIds.length !== 1) {
    return {
      error: {
        code: "invalid_vote",
        message: "Select exactly one option.",
      },
    };
  }

  return {
    poll: {
      ...poll,
      votes: {
        ...poll.votes,
        [userId]: uniqueOptionIds,
      },
    },
  };
};
