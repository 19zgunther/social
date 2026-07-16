---
name: code-review
description: >-
  Structured review of local diffs and PRs for intent, data model, correctness,
  structure, performance, schema, cleanliness, and error handling. Use when the
  user asks to review code, review a PR, review changes, or audit a diff.
---

# Code review

Walk the change set in order. Do not skip steps. End with a prioritized findings list.

## 1. Establish intent

Figure out what the change is trying to achieve before judging how it was built.

- **New capability:** What behavior is being introduced? Which surfaces, APIs, components, and shared modules are involved?
- **Change to existing behavior:** What did those features do before, and what is different now?

Write a short mental (or explicit) summary of intent so later findings stay grounded in the actual goal.

## 2. Data model and types

Inspect any type, interface, schema, or stored-shape edits.

- Redundant fields or duplicated state that could be derived instead
- Names that obscure meaning or invite misuse
- Fields or types that are unnecessary for the stated goal — flag candidates to drop or simplify

## 3. Correctness and design

Hunt for problems in how the change was implemented:

| Check | What to look for |
|-------|------------------|
| Logic | Wrong formulas, off-by-ones, bad conditionals, incorrect aggregations |
| Implementation | Bugs, edge cases, race conditions, broken invariants |
| Scope creep | Accidental behavior changes outside the stated intent |
| Incomplete rollout | Call sites, consumers, docs, or configs that should have been updated but were not |
| Fit | Whether this shape/architecture matches the feature, or a simpler/different approach would serve better |
| Duplication | New code that already exists elsewhere in the repo |
| Thin wrappers | One-off helpers that are trivial and used once — prefer inlining |
| Fragility | Tight coupling to other systems that will break if those change |
| Tests | Missing or weak coverage, especially around dense utility / pure logic |
| Naming | Identifiers that are cryptic, overly long, or misleading |
| Comments | Stale, wrong, or confusing comments that need fixing or removal |

## 4. Performance

Ask whether the change can hurt runtime cost.

- What is the hot path / asymptotic cost?
- How often does this run (per request, per render, batch job, etc.)?
- Call out concrete bottlenecks if any exist; skip vague "could be slow" notes without evidence.

## 5. Database / schema / migrations

If the diff touches schema, migrations, or Prisma models, open and follow `prisma/AGENT_README.md` before concluding the review.

## 6. Cleanliness

Note smells and anti-patterns (over-abstraction, dead code, inconsistent style with the repo, misuse of patterns already established nearby). Keep this section factual — list what you see.

## 7. Errors and UX of failure

Identify failure modes that should be caught, surfaced, or messaged to the user. Note silent failures and missing validation.

## 8. Deliver findings

Produce a **numbered list** of every issue, note, and suggested change. Each item must include:

- What you found and why it matters
- A priority: **HIGH**, **MEDIUM**, or **LOW**

Order roughly by priority (HIGH first). Include design/architecture notes and optional improvements, not only bugs.
