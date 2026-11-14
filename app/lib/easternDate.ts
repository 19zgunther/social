/** America/New_York calendar helpers for Daily Challenge day boundaries. */

const ET = "America/New_York";

/** YYYY-MM-DD in Eastern Time for the given instant. */
export function easternDateString(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Previous calendar day as YYYY-MM-DD (string arithmetic on the ET date). */
export function previousEasternDateString(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utc = new Date(Date.UTC(y!, m! - 1, d!));
  utc.setUTCDate(utc.getUTCDate() - 1);
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utc.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Prisma `@db.Date` value: UTC midnight for the calendar YYYY-MM-DD. */
export function dateStringToDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

export function dateToDateString(value: Date): string {
  const y = value.getUTCFullYear();
  const m = String(value.getUTCMonth() + 1).padStart(2, "0");
  const d = String(value.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Stable positive level number for Work Golf daily course generation.
 * Same ET date ⇒ same course for everyone.
 */
export function dailyLevelNumberForDate(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utc = Date.UTC(y!, m! - 1, d!);
  const epoch = Date.UTC(2024, 0, 1);
  return Math.max(1, Math.floor((utc - epoch) / 86_400_000) + 1);
}

/** Hour (0–23) in America/New_York for the given instant. */
export function easternHour(now: Date = new Date()): number {
  const hourPart = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    hour: "numeric",
    hourCycle: "h23",
  })
    .formatToParts(now)
    .find((part) => part.type === "hour")?.value;
  const hour = Number.parseInt(hourPart ?? "0", 10);
  return hour === 24 ? 0 : hour;
}
