import { describe, expect, it } from "vitest";
import {
  applyVote,
  sanitizePollForViewer,
  validateAndBuildPoll,
} from "@/app/lib/polls";
import { PollCreateInput, PollData } from "@/app/types/interfaces";

const NOW = new Date("2026-07-16T12:00:00.000Z");

const baseCreateInput = (overrides: Partial<PollCreateInput> = {}): PollCreateInput => ({
  options: [{ text: "Yes" }, { text: "No" }],
  selection_mode: "single",
  allow_vote_changes: false,
  duration_hours: 24,
  ...overrides,
});

const basePoll = (overrides: Partial<PollData> = {}): PollData => ({
  options: [
    { id: "opt-a", text: "Yes" },
    { id: "opt-b", text: "No" },
  ],
  selection_mode: "single",
  allow_vote_changes: false,
  closes_at: "2026-07-17T12:00:00.000Z",
  votes: {},
  ...overrides,
});

describe("validateAndBuildPoll", () => {
  it("builds a poll with generated option ids, empty votes, and closes_at from duration", () => {
    const result = validateAndBuildPoll(baseCreateInput({ duration_hours: 48 }), NOW);

    expect("poll" in result).toBe(true);
    if (!("poll" in result)) {
      return;
    }

    expect(result.poll.options).toHaveLength(2);
    expect(result.poll.options[0]?.text).toBe("Yes");
    expect(result.poll.options[1]?.text).toBe("No");
    expect(result.poll.options[0]?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(result.poll.options[0]?.id).not.toBe(result.poll.options[1]?.id);
    expect(result.poll.votes).toEqual({});
    expect(result.poll.selection_mode).toBe("single");
    expect(result.poll.allow_vote_changes).toBe(false);
    expect(result.poll.closes_at).toBe("2026-07-18T12:00:00.000Z");
  });

  it("trims options and drops blank entries", () => {
    const result = validateAndBuildPoll(
      baseCreateInput({
        options: [{ text: "  Alpha  " }, { text: "   " }, { text: "Beta" }],
      }),
      NOW,
    );

    expect("poll" in result).toBe(true);
    if (!("poll" in result)) {
      return;
    }
    expect(result.poll.options.map((option) => option.text)).toEqual(["Alpha", "Beta"]);
  });

  it("rejects fewer than 2 non-empty options", () => {
    const result = validateAndBuildPoll(
      baseCreateInput({ options: [{ text: "Only one" }, { text: "  " }] }),
      NOW,
    );

    expect(result).toEqual({
      error: {
        code: "invalid_poll",
        message: "Polls require at least 2 options.",
      },
    });
  });

  it("rejects more than 10 options", () => {
    const result = validateAndBuildPoll(
      baseCreateInput({
        options: Array.from({ length: 11 }, (_, index) => ({ text: `Option ${index + 1}` })),
      }),
      NOW,
    );

    expect(result).toEqual({
      error: {
        code: "invalid_poll",
        message: "Polls allow at most 10 options.",
      },
    });
  });

  it("rejects option text longer than 200 characters", () => {
    const result = validateAndBuildPoll(
      baseCreateInput({
        options: [{ text: "a".repeat(201) }, { text: "No" }],
      }),
      NOW,
    );

    expect(result).toEqual({
      error: {
        code: "invalid_poll",
        message: "Each option must be at most 200 characters.",
      },
    });
  });

  it("rejects invalid duration_hours", () => {
    const result = validateAndBuildPoll(
      {
        ...baseCreateInput(),
        duration_hours: 36 as PollCreateInput["duration_hours"],
      },
      NOW,
    );

    expect(result).toEqual({
      error: {
        code: "invalid_poll",
        message: "duration_hours must be 12, 24, 48, or 168.",
      },
    });
  });
});

describe("applyVote", () => {
  it("records a single-choice vote", () => {
    const result = applyVote({
      poll: basePoll(),
      userId: "user-1",
      optionIds: ["opt-a"],
      now: NOW,
    });

    expect(result).toEqual({
      poll: {
        ...basePoll(),
        votes: { "user-1": ["opt-a"] },
      },
    });
  });

  it("records a multiple-choice vote and dedupes option ids", () => {
    const result = applyVote({
      poll: basePoll({ selection_mode: "multiple" }),
      userId: "user-1",
      optionIds: ["opt-b", "opt-a", "opt-b", "  opt-a  "],
      now: NOW,
    });

    expect("poll" in result).toBe(true);
    if (!("poll" in result)) {
      return;
    }
    expect(result.poll.votes["user-1"]).toEqual(["opt-b", "opt-a"]);
  });

  it("rejects votes after close", () => {
    const result = applyVote({
      poll: basePoll({ closes_at: "2026-07-16T11:00:00.000Z" }),
      userId: "user-1",
      optionIds: ["opt-a"],
      now: NOW,
    });

    expect(result).toEqual({
      error: {
        code: "poll_closed",
        message: "This poll has closed.",
      },
    });
  });

  it("rejects a second vote when changes are disallowed", () => {
    const result = applyVote({
      poll: basePoll({
        allow_vote_changes: false,
        votes: { "user-1": ["opt-a"] },
      }),
      userId: "user-1",
      optionIds: ["opt-b"],
      now: NOW,
    });

    expect(result).toEqual({
      error: {
        code: "vote_locked",
        message: "You already voted and vote changes are not allowed.",
      },
    });
  });

  it("allows changing a vote when allow_vote_changes is true", () => {
    const result = applyVote({
      poll: basePoll({
        allow_vote_changes: true,
        votes: { "user-1": ["opt-a"] },
      }),
      userId: "user-1",
      optionIds: ["opt-b"],
      now: NOW,
    });

    expect(result).toEqual({
      poll: {
        ...basePoll({ allow_vote_changes: true }),
        votes: { "user-1": ["opt-b"] },
      },
    });
  });

  it("rejects empty selections", () => {
    const result = applyVote({
      poll: basePoll(),
      userId: "user-1",
      optionIds: ["  ", ""],
      now: NOW,
    });

    expect(result).toEqual({
      error: {
        code: "invalid_vote",
        message: "Select at least one option.",
      },
    });
  });

  it("rejects unknown option ids", () => {
    const result = applyVote({
      poll: basePoll(),
      userId: "user-1",
      optionIds: ["missing"],
      now: NOW,
    });

    expect(result).toEqual({
      error: {
        code: "invalid_vote",
        message: "One or more selected options are invalid.",
      },
    });
  });

  it("rejects multiple selections in single mode", () => {
    const result = applyVote({
      poll: basePoll({ selection_mode: "single" }),
      userId: "user-1",
      optionIds: ["opt-a", "opt-b"],
      now: NOW,
    });

    expect(result).toEqual({
      error: {
        code: "invalid_vote",
        message: "Select exactly one option.",
      },
    });
  });
});

describe("sanitizePollForViewer", () => {
  const pollWithVotes = basePoll({
    votes: {
      "user-1": ["opt-a"],
      "user-2": ["opt-b"],
      "user-3": ["opt-a", "opt-b"],
    },
  });

  it("hides results from a non-author who has not voted", () => {
    const view = sanitizePollForViewer({
      poll: pollWithVotes,
      viewerUserId: "viewer",
      authorUserId: "author",
      now: NOW,
    });

    expect(view.has_voted).toBe(false);
    expect(view.viewer_selection).toEqual([]);
    expect(view.is_closed).toBe(false);
    expect(view.results).toBeNull();
    expect(view.total_voters).toBeNull();
  });

  it("shows results and the viewer selection after voting", () => {
    const view = sanitizePollForViewer({
      poll: pollWithVotes,
      viewerUserId: "user-1",
      authorUserId: "author",
      now: NOW,
    });

    expect(view.has_voted).toBe(true);
    expect(view.viewer_selection).toEqual(["opt-a"]);
    expect(view.total_voters).toBe(3);
    expect(view.results).toEqual([
      { option_id: "opt-a", count: 2 },
      { option_id: "opt-b", count: 2 },
    ]);
  });

  it("lets the author see results without voting", () => {
    const view = sanitizePollForViewer({
      poll: pollWithVotes,
      viewerUserId: "author",
      authorUserId: "author",
      now: NOW,
    });

    expect(view.has_voted).toBe(false);
    expect(view.results).not.toBeNull();
    expect(view.total_voters).toBe(3);
  });

  it("shows results to everyone once the poll is closed", () => {
    const view = sanitizePollForViewer({
      poll: {
        ...pollWithVotes,
        closes_at: "2026-07-16T11:00:00.000Z",
      },
      viewerUserId: "viewer",
      authorUserId: "author",
      now: NOW,
    });

    expect(view.is_closed).toBe(true);
    expect(view.results).not.toBeNull();
    expect(view.total_voters).toBe(3);
  });

  it("does not expose the raw votes map", () => {
    const view = sanitizePollForViewer({
      poll: pollWithVotes,
      viewerUserId: "user-1",
      authorUserId: "author",
      now: NOW,
    });

    expect(view).not.toHaveProperty("votes");
  });
});
