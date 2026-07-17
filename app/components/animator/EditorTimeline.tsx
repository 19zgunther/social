"use client";

import type { Keyframe } from "./types";

type EditorTimelineProps = {
  durationMs: number;
  playheadT: number;
  playing: boolean;
  loop: boolean;
  keyframes: Keyframe[];
  selectedKeyframeId: string | null;
  canPaste: boolean;
  onPlayheadChange: (t: number) => void;
  onTogglePlay: () => void;
  onToggleLoop: () => void;
  onSelectKeyframe: (id: string | null) => void;
  onAddKeyframe: () => void;
  onDeleteKeyframe: () => void;
  onCopyKeyframe: () => void;
  onPasteKeyframe: () => void;
  onDurationChange: (ms: number) => void;
  onKeyframeTimeChange: (id: string, t: number) => void;
};

export default function EditorTimeline({
  durationMs,
  playheadT,
  playing,
  loop,
  keyframes,
  selectedKeyframeId,
  canPaste,
  onPlayheadChange,
  onTogglePlay,
  onToggleLoop,
  onSelectKeyframe,
  onAddKeyframe,
  onDeleteKeyframe,
  onCopyKeyframe,
  onPasteKeyframe,
  onDurationChange,
  onKeyframeTimeChange,
}: EditorTimelineProps) {
  const sorted = [...keyframes].sort((a, b) => a.t - b.t);

  const onTrackPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    onPlayheadChange(rect.width <= 0 ? 0 : x / rect.width);
  };

  return (
    <div className="border-t border-accent-1 bg-secondary-background px-3 py-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onTogglePlay}
          className="rounded border border-accent-1 px-3 py-1 text-xs text-foreground hover:bg-accent-1/30"
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          onClick={onToggleLoop}
          className={`rounded border px-3 py-1 text-xs ${
            loop
              ? "border-blue-400 text-blue-300"
              : "border-accent-1 text-foreground hover:bg-accent-1/30"
          }`}
        >
          Loop
        </button>
        <button
          type="button"
          onClick={onAddKeyframe}
          className="rounded border border-accent-1 px-3 py-1 text-xs text-foreground hover:bg-accent-1/30"
        >
          Add keyframe
        </button>
        <button
          type="button"
          onClick={onCopyKeyframe}
          className="rounded border border-accent-1 px-3 py-1 text-xs text-foreground hover:bg-accent-1/30"
          title="Copy selected keyframe (or pose at playhead) — ⌘/Ctrl+C"
        >
          Copy
        </button>
        <button
          type="button"
          onClick={onPasteKeyframe}
          disabled={!canPaste}
          className="rounded border border-accent-1 px-3 py-1 text-xs text-foreground hover:bg-accent-1/30 disabled:opacity-40"
          title="Paste keyframe at playhead — ⌘/Ctrl+V"
        >
          Paste
        </button>
        <button
          type="button"
          onClick={onDeleteKeyframe}
          disabled={!selectedKeyframeId || keyframes.length <= 1}
          className="rounded border border-accent-1 px-3 py-1 text-xs text-foreground hover:bg-accent-1/30 disabled:opacity-40"
        >
          Delete keyframe
        </button>
        <label className="ml-auto flex items-center gap-1 text-xs text-accent-2">
          Duration
          <input
            type="number"
            min={200}
            step={100}
            value={durationMs}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next) && next >= 200) {
                onDurationChange(next);
              }
            }}
            className="w-20 rounded border border-accent-1 bg-primary-background px-2 py-1 text-foreground"
          />
          ms
        </label>
        <span className="text-xs text-accent-2 tabular-nums">
          t={(playheadT * 100).toFixed(1)}%
        </span>
      </div>

      <div
        className="relative h-10 rounded bg-primary-background border border-accent-1 cursor-pointer"
        onPointerDown={onTrackPointer}
        onPointerMove={(event) => {
          if (event.buttons === 1) {
            onTrackPointer(event);
          }
        }}
      >
        {sorted.map((kf) => (
          <button
            key={kf.id}
            type="button"
            title={`Keyframe @ ${(kf.t * 100).toFixed(1)}%`}
            className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border ${
              kf.id === selectedKeyframeId
                ? "bg-blue-400 border-blue-200"
                : "bg-accent-2 border-foreground/40"
            }`}
            style={{ left: `${kf.t * 100}%` }}
            onPointerDown={(event) => {
              event.stopPropagation();
              onSelectKeyframe(kf.id);
              const track = event.currentTarget.parentElement;
              if (!track) {
                return;
              }
              const move = (ev: PointerEvent) => {
                const rect = track.getBoundingClientRect();
                const x = Math.min(Math.max(ev.clientX - rect.left, 0), rect.width);
                onKeyframeTimeChange(kf.id, rect.width <= 0 ? 0 : x / rect.width);
              };
              const up = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }}
          />
        ))}
        <div
          className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-red-400"
          style={{ left: `${playheadT * 100}%` }}
        />
      </div>
    </div>
  );
}
