import { describe, expect, it } from "vitest";
import { isBotDueAt, type BotWakeSchedule } from "@/app/lib/bots/botHelpers";

const daily = (overrides: Partial<BotWakeSchedule> = {}): BotWakeSchedule => ({
  wake_period: "24h",
  wake_time: "09:00",
  wake_weekday: 1,
  wake_timezone: "America/New_York",
  last_woke_at: null,
  ...overrides,
});

describe("isBotDueAt daily", () => {
  it("is not due before the scheduled local time", () => {
    // Tue Oct 20 2026, 08:30 in New York; last woke Mon Oct 19 at 09:05 local.
    const now = new Date("2026-10-20T12:30:00.000Z");
    expect(
      isBotDueAt(now, daily({ last_woke_at: new Date("2026-10-19T13:05:00.000Z") })),
    ).toBe(false);
  });

  it("is due once the scheduled local time passes", () => {
    // 09:30 in New York.
    const now = new Date("2026-10-20T13:30:00.000Z");
    expect(
      isBotDueAt(now, daily({ last_woke_at: new Date("2026-10-19T13:05:00.000Z") })),
    ).toBe(true);
  });

  it("is not due again after already waking that local day", () => {
    const now = new Date("2026-10-20T14:30:00.000Z");
    expect(
      isBotDueAt(now, daily({ last_woke_at: new Date("2026-10-20T13:05:00.000Z") })),
    ).toBe(false);
  });

  it("is due when never woken", () => {
    const now = new Date("2026-10-20T13:30:00.000Z");
    expect(isBotDueAt(now, daily())).toBe(true);
  });

  it("evaluates the schedule in the bot's own timezone", () => {
    // 12:30 UTC is before 09:00 in New York but after 09:00 UTC.
    const now = new Date("2026-10-20T12:30:00.000Z");
    const lastWoke = new Date("2026-10-19T09:05:00.000Z");
    expect(isBotDueAt(now, daily({ last_woke_at: lastWoke }))).toBe(false);
    expect(
      isBotDueAt(now, daily({ wake_timezone: "UTC", last_woke_at: lastWoke })),
    ).toBe(true);
  });
});

describe("isBotDueAt weekly", () => {
  const weekly = (overrides: Partial<BotWakeSchedule> = {}): BotWakeSchedule =>
    daily({ wake_period: "1w", wake_weekday: 1, ...overrides });
  const lastMonday = new Date("2026-10-12T13:05:00.000Z"); // Mon Oct 12, 09:05 NY

  it("is not due before the scheduled time on the scheduled day", () => {
    // Mon Oct 19, 08:30 in New York.
    expect(
      isBotDueAt(new Date("2026-10-19T12:30:00.000Z"), weekly({ last_woke_at: lastMonday })),
    ).toBe(false);
  });

  it("is due at the scheduled time on the scheduled day", () => {
    // Mon Oct 19, 09:30 in New York.
    expect(
      isBotDueAt(new Date("2026-10-19T13:30:00.000Z"), weekly({ last_woke_at: lastMonday })),
    ).toBe(true);
  });

  it("catches up the next day if the scheduled day was missed", () => {
    // Tue Oct 20, 09:30 in New York; never woke on Mon Oct 19.
    expect(
      isBotDueAt(new Date("2026-10-20T13:30:00.000Z"), weekly({ last_woke_at: lastMonday })),
    ).toBe(true);
  });

  it("is not due later in the week after waking on the scheduled day", () => {
    // Wed Oct 21; woke Mon Oct 19 at 09:05 local.
    expect(
      isBotDueAt(
        new Date("2026-10-21T13:30:00.000Z"),
        weekly({ last_woke_at: new Date("2026-10-19T13:05:00.000Z") }),
      ),
    ).toBe(false);
  });

  it("falls back to UTC and Monday defaults for invalid stored values", () => {
    const now = new Date("2026-10-20T13:30:00.000Z"); // Tuesday UTC
    expect(
      isBotDueAt(
        now,
        weekly({
          wake_time: "not-a-time",
          wake_weekday: 99,
          wake_timezone: "Not/AZone",
          last_woke_at: new Date("2026-10-12T13:05:00.000Z"),
        }),
      ),
    ).toBe(true);
  });
});
