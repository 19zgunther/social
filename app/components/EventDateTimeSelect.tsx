"use client";

import { useEffect, type ChangeEvent } from "react";
import { CalendarIcon, ClockIcon } from "@/app/components/Icons";

const DEFAULT_TIME = "12:00";
const DEFAULT_CREATE_START_TIME = "19:00";
const DEFAULT_CREATE_END_TIME = "21:00";
const DEFAULT_CREATE_DAYS_AHEAD = 3;

export type EventScheduleMode = "single_day" | "multi_day";

/** Convert API ISO string to `YYYY-MM-DDTHH:mm` in the user's local timezone. */
export function isoToEventLocalDatetime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function splitLocalDatetime(value: string): { date: string; time: string } {
  if (!value?.trim()) {
    return { date: "", time: "" };
  }
  const t = value.trim();
  const match = t.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})/);
  if (match) {
    return { date: match[1], time: match[2] };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    return { date: t, time: "" };
  }
  return { date: "", time: "" };
}

function joinLocalDatetime(date: string, time: string): string {
  if (!date) {
    return "";
  }
  const timePart = (time && time.length >= 4 ? time : DEFAULT_TIME).slice(0, 5);
  return `${date}T${timePart}`;
}

function todayLocalDateString(): string {
  return formatLocalDate(new Date());
}

const QUARTER_HOUR_TIMES: string[] = (() => {
  const times: string[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    for (const minute of [0, 15, 30, 45]) {
      times.push(`${pad2(hour)}:${pad2(minute)}`);
    }
  }
  return times;
})();

const LAST_SAME_DAY_START_TIME = "23:30";

function timeToMinutes(time: string): number {
  const match = time.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return 0;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function minutesToTime(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 45, totalMinutes));
  const hour = Math.floor(clamped / 60);
  const minute = clamped % 60;
  return `${pad2(hour)}:${pad2(minute)}`;
}

function snapToQuarterHour(time: string): string {
  if (!time) {
    return DEFAULT_CREATE_START_TIME;
  }
  const minutes = timeToMinutes(time.slice(0, 5));
  const snapped = Math.round(minutes / 15) * 15;
  return minutesToTime(Math.min(snapped, 23 * 60 + 45));
}

function formatQuarterHourLabel(time: string): string {
  const minutes = timeToMinutes(time);
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const hour12 = hour24 % 12 || 12;
  const suffix = hour24 < 12 ? "am" : "pm";
  return minute === 0 ? `${hour12}${suffix}` : `${hour12}:${pad2(minute)}${suffix}`;
}

function ensureEndAtLeast15AfterStart(startTime: string, endTime: string): string {
  const minEnd = timeToMinutes(startTime) + 15;
  if (timeToMinutes(endTime) >= minEnd) {
    return endTime;
  }
  return minutesToTime(Math.min(minEnd, 23 * 60 + 45));
}

/** Default create schedule: 3 days out, 7pm–9pm local. */
export function defaultCreateEventSchedule(): {
  startsAt: string;
  endsAt: string;
  mode: EventScheduleMode;
} {
  const day = new Date();
  day.setDate(day.getDate() + DEFAULT_CREATE_DAYS_AHEAD);
  const date = formatLocalDate(day);
  return {
    startsAt: joinLocalDatetime(date, DEFAULT_CREATE_START_TIME),
    endsAt: joinLocalDatetime(date, DEFAULT_CREATE_END_TIME),
    mode: "single_day",
  };
}

export function scheduleModeForRange(startsAt: string, endsAt: string): EventScheduleMode {
  const startDate = splitLocalDatetime(startsAt).date;
  const endDate = splitLocalDatetime(endsAt).date;
  if (startDate && endDate && startDate !== endDate) {
    return "multi_day";
  }
  return "single_day";
}

const fieldInputClass =
  "min-h-[44px] w-full rounded-lg border border-white/15 bg-bg/75 px-3 py-2 text-sm text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_4px_14px_rgba(0,0,0,0.38)] outline-none backdrop-blur-md transition focus:border-muted [color-scheme:dark] disabled:cursor-not-allowed disabled:opacity-50";

const inlineFieldInputClass =
  "min-h-[40px] w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground outline-none transition focus:border-muted [color-scheme:dark] disabled:cursor-not-allowed disabled:opacity-50";

const singleDayFieldClass =
  "h-8 min-h-0 min-w-0 rounded-md border border-border bg-surface px-1 text-xs leading-none text-foreground outline-none transition focus:border-muted [color-scheme:dark] disabled:cursor-not-allowed disabled:opacity-50";

const rootShellClass =
  "rounded-xl border border-white/12 bg-bg/48 p-2.5 shadow-[0_6px_26px_rgba(0,0,0,0.42)] backdrop-blur-xl transition-[box-shadow,border-color] [color-scheme:dark] focus-within:border-muted/90 focus-within:shadow-[0_10px_36px_rgba(0,0,0,0.5)] focus-within:ring-1 focus-within:ring-white/18";

type EventDateTimeSelectProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
  /** Merged onto the root shell (e.g. stronger glass on photo backgrounds). */
  className?: string;
  /** Date + time in one row, without per-field Date/Time titles. */
  compactFields?: boolean;
  /**
   * `card` — glass shell with calendar badge (default).
   * `inline` — compact label + inputs, for nesting in a shared schedule block.
   */
  variant?: "card" | "inline";
};

/**
 * Pairs native date + time inputs so OS pickers (wheels, calendars) are used separately
 * instead of a single cramped `datetime-local` control.
 */
export default function EventDateTimeSelect({
  label,
  value,
  onChange,
  disabled,
  id,
  className,
  compactFields = false,
  variant = "card",
}: EventDateTimeSelectProps) {
  const { date, time } = splitLocalDatetime(value);

  const onDateChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextDate = event.target.value;
    const nextTime = time || DEFAULT_TIME;
    onChange(joinLocalDatetime(nextDate, nextTime));
  };

  const onTimeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextTime = event.target.value;
    const datePart = date || todayLocalDateString();
    onChange(joinLocalDatetime(datePart, nextTime));
  };

  /** Show a sensible default in the time control once a date exists; empty until then so placeholders feel clean. */
  const timeValue = date ? (time || DEFAULT_TIME) : time;

  if (variant === "inline") {
    return (
      <div id={id} className={`space-y-1.5 ${className ?? ""}`}>
        <span className="text-xs font-medium text-muted">{label}</span>
        <div className="grid min-w-0 grid-cols-2 gap-2">
          <input
            type="date"
            aria-label={`${label} date`}
            value={date}
            onChange={onDateChange}
            disabled={disabled}
            className={`${inlineFieldInputClass} box-border min-w-0 max-w-full`}
          />
          <input
            type="time"
            aria-label={`${label} time`}
            step={60}
            value={timeValue}
            onChange={onTimeChange}
            disabled={disabled}
            className={`${inlineFieldInputClass} box-border min-w-0 max-w-full`}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      id={id}
      className={`${rootShellClass}${className ? ` ${className}` : ""}`}
    >
      <div className="mb-2 flex items-center gap-2 border-b border-white/10 pb-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-border/70 text-accent shadow-md backdrop-blur-sm">
          <CalendarIcon className="h-3.5 w-3.5" aria-hidden />
        </span>
        <span className="text-xs font-semibold tracking-wide text-foreground [text-shadow:0_2px_8px_rgba(0,0,0,0.9)]">
          {label}
        </span>
      </div>

      {compactFields ? (
        <div className="grid min-w-0 grid-cols-2 gap-2">
          <input
            type="date"
            aria-label={`${label} date`}
            value={date}
            onChange={onDateChange}
            disabled={disabled}
            className={`${fieldInputClass} box-border min-w-0 max-w-full`}
          />
          <input
            type="time"
            aria-label={`${label} time`}
            step={60}
            value={timeValue}
            onChange={onTimeChange}
            disabled={disabled}
            className={`${fieldInputClass} box-border min-w-0 max-w-full`}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1 space-y-1">
            <label className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-foreground/88 [text-shadow:0_2px_6px_rgba(0,0,0,0.88)]">
              <CalendarIcon className="h-3 w-3 opacity-80" aria-hidden />
              Date
            </label>
            <input
              type="date"
              value={date}
              onChange={onDateChange}
              disabled={disabled}
              className={fieldInputClass}
            />
          </div>
          <div className="w-full shrink-0 space-y-1 sm:w-[9.5rem]">
            <label className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-foreground/88 [text-shadow:0_2px_6px_rgba(0,0,0,0.88)]">
              <ClockIcon className="h-3 w-3 opacity-80" aria-hidden />
              Time
            </label>
            <input
              type="time"
              step={60}
              value={timeValue}
              onChange={onTimeChange}
              disabled={disabled}
              className={fieldInputClass}
            />
          </div>
        </div>
      )}
    </div>
  );
}

type EventScheduleFieldsProps = {
  mode: EventScheduleMode;
  onModeChange: (mode: EventScheduleMode) => void;
  startsAt: string;
  endsAt: string;
  onStartsAtChange: (value: string) => void;
  onEndsAtChange: (value: string) => void;
  disabled?: boolean;
};

/** Single-day (`On date from/to`) or multi-day (full start/end datetimes). */
export function EventScheduleFields({
  mode,
  onModeChange,
  startsAt,
  endsAt,
  onStartsAtChange,
  onEndsAtChange,
  disabled = false,
}: EventScheduleFieldsProps) {
  const startParts = splitLocalDatetime(startsAt);
  const endParts = splitLocalDatetime(endsAt);
  const dayValue = startParts.date;
  const fromTime = snapToQuarterHour(
    startParts.time || DEFAULT_CREATE_START_TIME,
  );
  const clampedFromTime =
    timeToMinutes(fromTime) > timeToMinutes(LAST_SAME_DAY_START_TIME)
      ? LAST_SAME_DAY_START_TIME
      : fromTime;
  const toTime = ensureEndAtLeast15AfterStart(
    clampedFromTime,
    snapToQuarterHour(endParts.time || DEFAULT_CREATE_END_TIME),
  );
  const endOptions = QUARTER_HOUR_TIMES.filter(
    (time) => timeToMinutes(time) >= timeToMinutes(clampedFromTime) + 15,
  );
  const startOptions = QUARTER_HOUR_TIMES.filter(
    (time) => timeToMinutes(time) <= timeToMinutes(LAST_SAME_DAY_START_TIME),
  );

  const applySingleDayTimes = (date: string, startTime: string, endTime: string) => {
    const nextStart =
      timeToMinutes(startTime) > timeToMinutes(LAST_SAME_DAY_START_TIME)
        ? LAST_SAME_DAY_START_TIME
        : startTime;
    const nextEnd = ensureEndAtLeast15AfterStart(nextStart, endTime);
    onStartsAtChange(joinLocalDatetime(date, nextStart));
    onEndsAtChange(joinLocalDatetime(date, nextEnd));
  };

  useEffect(() => {
    if (mode !== "single_day") {
      return;
    }
    const date = dayValue || todayLocalDateString();
    const nextStartsAt = joinLocalDatetime(date, clampedFromTime);
    const nextEndsAt = joinLocalDatetime(date, toTime);
    if (nextStartsAt !== startsAt || nextEndsAt !== endsAt) {
      onStartsAtChange(nextStartsAt);
      onEndsAtChange(nextEndsAt);
    }
  }, [
    mode,
    dayValue,
    clampedFromTime,
    toTime,
    startsAt,
    endsAt,
    onStartsAtChange,
    onEndsAtChange,
  ]);

  const onSelectMode = (nextMode: EventScheduleMode) => {
    if (nextMode === mode) {
      return;
    }
    if (nextMode === "single_day") {
      const date = startParts.date || endParts.date || todayLocalDateString();
      applySingleDayTimes(
        date,
        snapToQuarterHour(startParts.time || DEFAULT_CREATE_START_TIME),
        snapToQuarterHour(endParts.time || DEFAULT_CREATE_END_TIME),
      );
    } else {
      const startDate = startParts.date || todayLocalDateString();
      const endDate = endParts.date && endParts.date !== startDate ? endParts.date : startDate;
      onStartsAtChange(
        joinLocalDatetime(startDate, startParts.time || DEFAULT_CREATE_START_TIME),
      );
      onEndsAtChange(joinLocalDatetime(endDate, endParts.time || DEFAULT_CREATE_END_TIME));
    }
    onModeChange(nextMode);
  };

  const onDayChange = (event: ChangeEvent<HTMLInputElement>) => {
    applySingleDayTimes(event.target.value, clampedFromTime, toTime);
  };

  const onFromSelectChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const datePart = dayValue || todayLocalDateString();
    applySingleDayTimes(datePart, event.target.value, toTime);
  };

  const onToSelectChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const datePart = dayValue || todayLocalDateString();
    applySingleDayTimes(datePart, clampedFromTime, event.target.value);
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-1 rounded-lg border border-border bg-surface p-0.5">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSelectMode("single_day")}
          className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition ${
            mode === "single_day"
              ? "bg-bg text-foreground shadow-sm"
              : "text-muted hover:text-foreground"
          }`}
        >
          Single day
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSelectMode("multi_day")}
          className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition ${
            mode === "multi_day"
              ? "bg-bg text-foreground shadow-sm"
              : "text-muted hover:text-foreground"
          }`}
        >
          Multi-day
        </button>
      </div>

      {mode === "single_day" ? (
        <div className="flex min-w-0 items-center gap-1 text-xs text-foreground">
          <span className="shrink-0 text-muted">On</span>
          <input
            type="date"
            aria-label="Event day"
            value={dayValue}
            onChange={onDayChange}
            disabled={disabled}
            className={`${singleDayFieldClass} w-0 flex-1`}
          />
          <span className="shrink-0 text-muted">from</span>
          <select
            aria-label="Starts at"
            value={clampedFromTime}
            onChange={onFromSelectChange}
            disabled={disabled}
            className={`${singleDayFieldClass} w-[3.9rem] shrink-0 appearance-none pr-0.5 text-center`}
          >
            {startOptions.map((time) => (
              <option key={`start-${time}`} value={time}>
                {formatQuarterHourLabel(time)}
              </option>
            ))}
          </select>
          <span className="shrink-0 text-muted">to</span>
          <select
            aria-label="Ends at"
            value={toTime}
            onChange={onToSelectChange}
            disabled={disabled || endOptions.length === 0}
            className={`${singleDayFieldClass} w-[3.9rem] shrink-0 appearance-none pr-0.5 text-center`}
          >
            {endOptions.map((time) => (
              <option key={`end-${time}`} value={time}>
                {formatQuarterHourLabel(time)}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="space-y-2">
          <EventDateTimeSelect
            variant="inline"
            label="Starts"
            value={startsAt}
            onChange={onStartsAtChange}
            disabled={disabled}
          />
          <EventDateTimeSelect
            variant="inline"
            label="Ends"
            value={endsAt}
            onChange={onEndsAtChange}
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
}
