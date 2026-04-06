"use client";

import type { ChangeEvent } from "react";
import { Calendar, Clock } from "lucide-react";

const DEFAULT_TIME = "12:00";

/** Convert API ISO string to `YYYY-MM-DDTHH:mm` in the user's local timezone. */
export function isoToEventLocalDatetime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
}

const fieldInputClass =
  "min-h-[44px] w-full rounded-lg border border-white/15 bg-primary-background/75 px-3 py-2 text-sm text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_4px_14px_rgba(0,0,0,0.38)] outline-none backdrop-blur-md transition focus:border-accent-2 [color-scheme:dark] disabled:cursor-not-allowed disabled:opacity-50";

const rootShellClass =
  "rounded-xl border border-white/12 bg-primary-background/48 p-2.5 shadow-[0_6px_26px_rgba(0,0,0,0.42)] backdrop-blur-xl transition-[box-shadow,border-color] [color-scheme:dark] focus-within:border-accent-2/90 focus-within:shadow-[0_10px_36px_rgba(0,0,0,0.5)] focus-within:ring-1 focus-within:ring-white/18";

type EventDateTimeSelectProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
  /** Merged onto the root shell (e.g. stronger glass on photo backgrounds). */
  className?: string;
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

  return (
    <div
      id={id}
      className={`${rootShellClass}${className ? ` ${className}` : ""}`}
    >
      <div className="mb-2 flex items-center gap-2 border-b border-white/10 pb-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-accent-1/70 text-accent-3 shadow-md backdrop-blur-sm">
          <Calendar className="h-3.5 w-3.5" aria-hidden />
        </span>
        <span className="text-xs font-semibold tracking-wide text-foreground [text-shadow:0_2px_8px_rgba(0,0,0,0.9)]">
          {label}
        </span>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-1">
          <label className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-foreground/88 [text-shadow:0_2px_6px_rgba(0,0,0,0.88)]">
            <Calendar className="h-3 w-3 opacity-80" aria-hidden />
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
            <Clock className="h-3 w-3 opacity-80" aria-hidden />
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
    </div>
  );
}
