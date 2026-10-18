import { randomUUID } from "node:crypto";
import {
  TierListCreateInput,
  TierListData,
  TierListOption,
  TierListResultCell,
  TierListTier,
  TierListViewerState,
} from "@/app/types/interfaces";

export const MIN_TIERS = 2;
export const MAX_TIERS = 8;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 16;
const MAX_TEXT_LENGTH = 200;

export type TierListValidationError = {
  code: string;
  message: string;
};

const trimUniqueLabels = (
  values: string[],
  kind: "tier" | "option",
): { labels: string[] } | { error: TierListValidationError } => {
  const labels: string[] = [];
  const seen = new Set<string>();
  const noun = kind === "tier" ? "tier name" : "option";
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.length > MAX_TEXT_LENGTH) {
      return {
        error: {
          code: "invalid_tier_list",
          message: `Each ${noun} must be at most ${MAX_TEXT_LENGTH} characters.`,
        },
      };
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      return {
        error: {
          code: "invalid_tier_list",
          message: kind === "tier" ? "Tier names must be unique." : "Options must be unique.",
        },
      };
    }
    seen.add(key);
    labels.push(trimmed);
  }
  return { labels };
};

export const parseTierListData = (value: unknown): TierListData | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.tiers) || raw.tiers.length < MIN_TIERS || raw.tiers.length > MAX_TIERS) {
    return null;
  }
  if (
    !Array.isArray(raw.options) ||
    raw.options.length < MIN_OPTIONS ||
    raw.options.length > MAX_OPTIONS
  ) {
    return null;
  }

  const tiers: TierListTier[] = [];
  for (const tier of raw.tiers) {
    if (!tier || typeof tier !== "object" || Array.isArray(tier)) {
      return null;
    }
    const tierRecord = tier as Record<string, unknown>;
    if (typeof tierRecord.id !== "string" || !tierRecord.id.trim()) {
      return null;
    }
    if (typeof tierRecord.name !== "string" || !tierRecord.name.trim()) {
      return null;
    }
    tiers.push({ id: tierRecord.id.trim(), name: tierRecord.name.trim() });
  }

  const options: TierListOption[] = [];
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

  const validTierIds = new Set(tiers.map((tier) => tier.id));
  const validOptionIds = new Set(options.map((option) => option.id));
  const submissions: Record<string, Record<string, string>> = {};
  if (raw.submissions && typeof raw.submissions === "object" && !Array.isArray(raw.submissions)) {
    for (const [userId, assignment] of Object.entries(
      raw.submissions as Record<string, unknown>,
    )) {
      if (!userId || !assignment || typeof assignment !== "object" || Array.isArray(assignment)) {
        continue;
      }
      const cleaned: Record<string, string> = {};
      for (const [optionId, tierId] of Object.entries(assignment as Record<string, unknown>)) {
        if (
          typeof optionId === "string" &&
          typeof tierId === "string" &&
          validOptionIds.has(optionId) &&
          validTierIds.has(tierId)
        ) {
          cleaned[optionId] = tierId;
        }
      }
      if (Object.keys(cleaned).length === options.length) {
        submissions[userId] = cleaned;
      }
    }
  }

  return { tiers, options, submissions };
};

export const parseTierListCreateInput = (value: unknown): TierListCreateInput | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.tiers) || !Array.isArray(raw.options)) {
    return null;
  }

  const tiers: Array<{ name: string }> = [];
  for (const tier of raw.tiers) {
    if (!tier || typeof tier !== "object" || Array.isArray(tier)) {
      return null;
    }
    const tierRecord = tier as Record<string, unknown>;
    if (typeof tierRecord.name !== "string") {
      return null;
    }
    tiers.push({ name: tierRecord.name });
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

  return { tiers, options };
};

export const validateAndBuildTierList = (
  input: TierListCreateInput,
): { tierList: TierListData } | { error: TierListValidationError } => {
  const tierResult = trimUniqueLabels(
    input.tiers.map((tier) => tier.name),
    "tier",
  );
  if ("error" in tierResult) {
    return { error: tierResult.error };
  }
  if (tierResult.labels.length < MIN_TIERS) {
    return {
      error: {
        code: "invalid_tier_list",
        message: `Tier lists require at least ${MIN_TIERS} tiers.`,
      },
    };
  }
  if (tierResult.labels.length > MAX_TIERS) {
    return {
      error: {
        code: "invalid_tier_list",
        message: `Tier lists allow at most ${MAX_TIERS} tiers.`,
      },
    };
  }

  const optionResult = trimUniqueLabels(
    input.options.map((option) => option.text),
    "option",
  );
  if ("error" in optionResult) {
    return { error: optionResult.error };
  }
  if (optionResult.labels.length < MIN_OPTIONS) {
    return {
      error: {
        code: "invalid_tier_list",
        message: `Tier lists require at least ${MIN_OPTIONS} options.`,
      },
    };
  }
  if (optionResult.labels.length > MAX_OPTIONS) {
    return {
      error: {
        code: "invalid_tier_list",
        message: `Tier lists allow at most ${MAX_OPTIONS} options.`,
      },
    };
  }

  return {
    tierList: {
      tiers: tierResult.labels.map((name) => ({ id: randomUUID(), name })),
      options: optionResult.labels.map((text) => ({ id: randomUUID(), text })),
      submissions: {},
    },
  };
};

export const buildTierListResults = (
  tierList: TierListData,
): { results: TierListResultCell[]; totalSubmitters: number } => {
  const totalSubmitters = Object.keys(tierList.submissions).length;
  if (totalSubmitters === 0) {
    return { results: [], totalSubmitters: 0 };
  }

  const counts = new Map<string, number>();
  for (const assignment of Object.values(tierList.submissions)) {
    for (const [optionId, tierId] of Object.entries(assignment)) {
      const key = `${tierId}:${optionId}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const results: TierListResultCell[] = [];
  for (const tier of tierList.tiers) {
    for (const option of tierList.options) {
      const count = counts.get(`${tier.id}:${option.id}`) ?? 0;
      if (count <= 0) {
        continue;
      }
      const percentage = Math.round((count / totalSubmitters) * 100);
      if (percentage > 0) {
        results.push({
          tier_id: tier.id,
          option_id: option.id,
          percentage,
        });
      }
    }
  }

  return { results, totalSubmitters };
};

export const sanitizeTierListForViewer = ({
  tierList,
  viewerUserId,
}: {
  tierList: TierListData;
  viewerUserId: string;
}): TierListViewerState => {
  const viewerAssignment = tierList.submissions[viewerUserId] ?? null;
  const hasSubmitted = Boolean(viewerAssignment);
  const { results, totalSubmitters } = buildTierListResults(tierList);

  return {
    tiers: tierList.tiers.map((tier) => ({ id: tier.id, name: tier.name })),
    options: tierList.options.map((option) => ({ id: option.id, text: option.text })),
    has_submitted: hasSubmitted,
    viewer_assignment: hasSubmitted ? { ...viewerAssignment } : null,
    results: hasSubmitted ? results : null,
    total_submitters: hasSubmitted ? totalSubmitters : null,
  };
};

export type TierListSubmissionBreakdownRow = {
  user_id: string;
  assignment: Record<string, string>;
};

export const buildTierListSubmissionBreakdown = (
  tierList: TierListData,
): TierListSubmissionBreakdownRow[] => {
  return Object.entries(tierList.submissions).map(([userId, assignment]) => ({
    user_id: userId,
    assignment: { ...assignment },
  }));
};

export const applyTierListSubmission = ({
  tierList,
  userId,
  assignment,
}: {
  tierList: TierListData;
  userId: string;
  assignment: Record<string, string>;
}): { tierList: TierListData } | { error: TierListValidationError } => {
  if (tierList.submissions[userId]) {
    return {
      error: {
        code: "submission_locked",
        message: "You already submitted a tier list and cannot change it.",
      },
    };
  }

  const validTierIds = new Set(tierList.tiers.map((tier) => tier.id));
  const validOptionIds = new Set(tierList.options.map((option) => option.id));
  const cleaned: Record<string, string> = {};

  for (const [rawOptionId, rawTierId] of Object.entries(assignment)) {
    const optionId = typeof rawOptionId === "string" ? rawOptionId.trim() : "";
    const tierId = typeof rawTierId === "string" ? rawTierId.trim() : "";
    if (!optionId || !tierId) {
      continue;
    }
    if (!validOptionIds.has(optionId) || !validTierIds.has(tierId)) {
      return {
        error: {
          code: "invalid_submission",
          message: "One or more assignments are invalid.",
        },
      };
    }
    if (cleaned[optionId] !== undefined) {
      return {
        error: {
          code: "invalid_submission",
          message: "Each option can only be in one tier.",
        },
      };
    }
    cleaned[optionId] = tierId;
  }

  if (Object.keys(cleaned).length !== tierList.options.length) {
    return {
      error: {
        code: "invalid_submission",
        message: "Every option must be placed in a tier.",
      },
    };
  }

  for (const option of tierList.options) {
    if (!cleaned[option.id]) {
      return {
        error: {
          code: "invalid_submission",
          message: "Every option must be placed in a tier.",
        },
      };
    }
  }

  return {
    tierList: {
      ...tierList,
      submissions: {
        ...tierList.submissions,
        [userId]: cleaned,
      },
    },
  };
};
