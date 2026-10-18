import { describe, expect, it } from "vitest";
import {
  applyTierListSubmission,
  buildTierListResults,
  sanitizeTierListForViewer,
  validateAndBuildTierList,
} from "@/app/lib/tierLists";
import { TierListCreateInput, TierListData } from "@/app/types/interfaces";

const baseCreateInput = (overrides: Partial<TierListCreateInput> = {}): TierListCreateInput => ({
  tiers: [{ name: "S" }, { name: "A" }, { name: "B" }],
  options: [{ text: "Alpha" }, { text: "Beta" }],
  ...overrides,
});

const baseTierList = (overrides: Partial<TierListData> = {}): TierListData => ({
  tiers: [
    { id: "tier-s", name: "S" },
    { id: "tier-a", name: "A" },
  ],
  options: [
    { id: "opt-a", text: "Alpha" },
    { id: "opt-b", text: "Beta" },
  ],
  submissions: {},
  ...overrides,
});

describe("validateAndBuildTierList", () => {
  it("builds a tier list with generated ids and empty submissions", () => {
    const result = validateAndBuildTierList(baseCreateInput());

    expect("tierList" in result).toBe(true);
    if (!("tierList" in result)) {
      return;
    }

    expect(result.tierList.tiers.map((tier) => tier.name)).toEqual(["S", "A", "B"]);
    expect(result.tierList.options.map((option) => option.text)).toEqual(["Alpha", "Beta"]);
    expect(result.tierList.tiers[0]?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(result.tierList.submissions).toEqual({});
  });

  it("trims labels and drops blanks", () => {
    const result = validateAndBuildTierList(
      baseCreateInput({
        tiers: [{ name: "  S  " }, { name: "   " }, { name: "A" }],
        options: [{ text: "  Alpha  " }, { text: " " }, { text: "Beta" }],
      }),
    );

    expect("tierList" in result).toBe(true);
    if (!("tierList" in result)) {
      return;
    }
    expect(result.tierList.tiers.map((tier) => tier.name)).toEqual(["S", "A"]);
    expect(result.tierList.options.map((option) => option.text)).toEqual(["Alpha", "Beta"]);
  });

  it("rejects fewer than 2 tiers", () => {
    const result = validateAndBuildTierList(
      baseCreateInput({ tiers: [{ name: "S" }, { name: "  " }] }),
    );
    expect(result).toEqual({
      error: {
        code: "invalid_tier_list",
        message: "Tier lists require at least 2 tiers.",
      },
    });
  });

  it("rejects duplicate option names case-insensitively", () => {
    const result = validateAndBuildTierList(
      baseCreateInput({
        options: [{ text: "Alpha" }, { text: "alpha" }],
      }),
    );
    expect(result).toEqual({
      error: {
        code: "invalid_tier_list",
        message: "Options must be unique.",
      },
    });
  });

  it("rejects more than 16 options", () => {
    const result = validateAndBuildTierList(
      baseCreateInput({
        options: Array.from({ length: 17 }, (_, index) => ({ text: `Option ${index + 1}` })),
      }),
    );
    expect(result).toEqual({
      error: {
        code: "invalid_tier_list",
        message: "Tier lists allow at most 16 options.",
      },
    });
  });
});

describe("applyTierListSubmission", () => {
  it("records a complete assignment", () => {
    const result = applyTierListSubmission({
      tierList: baseTierList(),
      userId: "user-1",
      assignment: { "opt-a": "tier-s", "opt-b": "tier-a" },
    });

    expect(result).toEqual({
      tierList: {
        ...baseTierList(),
        submissions: {
          "user-1": { "opt-a": "tier-s", "opt-b": "tier-a" },
        },
      },
    });
  });

  it("rejects a second submission", () => {
    const result = applyTierListSubmission({
      tierList: baseTierList({
        submissions: {
          "user-1": { "opt-a": "tier-s", "opt-b": "tier-a" },
        },
      }),
      userId: "user-1",
      assignment: { "opt-a": "tier-a", "opt-b": "tier-s" },
    });

    expect(result).toEqual({
      error: {
        code: "submission_locked",
        message: "You already submitted a tier list and cannot change it.",
      },
    });
  });

  it("rejects incomplete assignments", () => {
    const result = applyTierListSubmission({
      tierList: baseTierList(),
      userId: "user-1",
      assignment: { "opt-a": "tier-s" },
    });

    expect(result).toEqual({
      error: {
        code: "invalid_submission",
        message: "Every option must be placed in a tier.",
      },
    });
  });

  it("rejects unknown tier or option ids", () => {
    const result = applyTierListSubmission({
      tierList: baseTierList(),
      userId: "user-1",
      assignment: { "opt-a": "tier-s", "opt-b": "missing" },
    });

    expect(result).toEqual({
      error: {
        code: "invalid_submission",
        message: "One or more assignments are invalid.",
      },
    });
  });
});

describe("buildTierListResults / sanitizeTierListForViewer", () => {
  const tierListWithSubmissions = baseTierList({
    submissions: {
      "user-1": { "opt-a": "tier-s", "opt-b": "tier-a" },
      "user-2": { "opt-a": "tier-s", "opt-b": "tier-s" },
    },
  });

  it("computes percentages and omits zero cells", () => {
    const { results, totalSubmitters } = buildTierListResults(tierListWithSubmissions);
    expect(totalSubmitters).toBe(2);
    expect(results).toEqual([
      { tier_id: "tier-s", option_id: "opt-a", percentage: 100 },
      { tier_id: "tier-s", option_id: "opt-b", percentage: 50 },
      { tier_id: "tier-a", option_id: "opt-b", percentage: 50 },
    ]);
  });

  it("hides results until the viewer has submitted", () => {
    const view = sanitizeTierListForViewer({
      tierList: tierListWithSubmissions,
      viewerUserId: "viewer",
    });

    expect(view.has_submitted).toBe(false);
    expect(view.viewer_assignment).toBeNull();
    expect(view.results).toBeNull();
    expect(view.total_submitters).toBeNull();
    expect(view).not.toHaveProperty("submissions");
  });

  it("shows results and the viewer assignment after submit", () => {
    const view = sanitizeTierListForViewer({
      tierList: tierListWithSubmissions,
      viewerUserId: "user-1",
    });

    expect(view.has_submitted).toBe(true);
    expect(view.viewer_assignment).toEqual({ "opt-a": "tier-s", "opt-b": "tier-a" });
    expect(view.total_submitters).toBe(2);
    expect(view.results).toHaveLength(3);
  });
});
