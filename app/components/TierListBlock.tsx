"use client";

import { PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, PostData, TierListViewerState } from "@/app/types/interfaces";
import { DONT_SWIPE_TABS_CLASSNAME } from "@/app/components/utils/useSwipeBack";

type TierListBlockProps = {
  postId: string;
  tierList: TierListViewerState;
  isPreview?: boolean;
  onTierListUpdated?: (data: PostData) => void;
};

type DragState = {
  optionId: string;
  label: string;
  pointerId: number;
  originX: number;
  originY: number;
  x: number;
  y: number;
  active: boolean;
};

const DRAG_THRESHOLD_PX = 8;
const UNASSIGNED_DROP_ID = "__unassigned__";

const isTierListViewerState = (value: unknown): value is TierListViewerState => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.has_submitted === "boolean" &&
    Array.isArray(record.tiers) &&
    Array.isArray(record.options)
  );
};

export const getTierListViewerState = (
  data: PostData | null | undefined,
): TierListViewerState | null => {
  if (!data?.tier_list || !isTierListViewerState(data.tier_list)) {
    return null;
  }
  return data.tier_list;
};

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as ApiError;
    return body.error?.message ?? "Failed to submit tier list.";
  } catch {
    return "Failed to submit tier list.";
  }
};

const dropTargetFromPoint = (clientX: number, clientY: number): string | null => {
  const element = document.elementFromPoint(clientX, clientY);
  if (!(element instanceof Element)) {
    return null;
  }
  const dropZone = element.closest("[data-tier-drop]");
  if (!(dropZone instanceof HTMLElement)) {
    return null;
  }
  return dropZone.dataset.tierDrop ?? null;
};

export default function TierListBlock({
  postId,
  tierList,
  isPreview = false,
  onTierListUpdated,
}: TierListBlockProps) {
  const [assignment, setAssignment] = useState<Record<string, string>>(
    () => tierList.viewer_assignment ?? {},
  );
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const dragStateRef = useRef<DragState | null>(null);
  const interactionLocked = isPreview || tierList.has_submitted;

  useEffect(() => {
    setAssignment(tierList.viewer_assignment ?? {});
    setSelectedOptionId(null);
    setDragState(null);
    setDropTargetId(null);
    setStatusMessage("");
  }, [tierList]);

  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);

  const optionTextById = useMemo(() => {
    const map = new Map<string, string>();
    for (const option of tierList.options) {
      map.set(option.id, option.text);
    }
    return map;
  }, [tierList.options]);

  const unassignedOptions = useMemo(
    () => tierList.options.filter((option) => !assignment[option.id]),
    [assignment, tierList.options],
  );

  const optionsByTier = useMemo(() => {
    const grouped = new Map<string, string[]>();
    for (const tier of tierList.tiers) {
      grouped.set(tier.id, []);
    }
    for (const [optionId, tierId] of Object.entries(assignment)) {
      grouped.get(tierId)?.push(optionId);
    }
    return grouped;
  }, [assignment, tierList.tiers]);

  const resultsByTier = useMemo(() => {
    const grouped = new Map<string, Array<{ optionId: string; percentage: number }>>();
    for (const tier of tierList.tiers) {
      grouped.set(tier.id, []);
    }
    for (const cell of tierList.results ?? []) {
      grouped.get(cell.tier_id)?.push({
        optionId: cell.option_id,
        percentage: cell.percentage,
      });
    }
    return grouped;
  }, [tierList.results, tierList.tiers]);

  const canSubmit =
    !isPreview && !tierList.has_submitted && unassignedOptions.length === 0 && !isSubmitting;

  const placeOptionInTier = (optionId: string, tierId: string) => {
    setAssignment((previous) => ({
      ...previous,
      [optionId]: tierId,
    }));
    setSelectedOptionId(null);
  };

  const unassignOption = (optionId: string) => {
    setAssignment((previous) => {
      const next = { ...previous };
      delete next[optionId];
      return next;
    });
    setSelectedOptionId(null);
  };

  const onSelectOption = (optionId: string) => {
    if (interactionLocked) {
      return;
    }
    if (assignment[optionId]) {
      unassignOption(optionId);
      return;
    }
    setSelectedOptionId((previous) => (previous === optionId ? null : optionId));
  };

  const onSelectTier = (tierId: string) => {
    if (interactionLocked || !selectedOptionId) {
      return;
    }
    placeOptionInTier(selectedOptionId, tierId);
  };

  const onOptionPointerDown = (event: PointerEvent<HTMLButtonElement>, optionId: string) => {
    if (interactionLocked || event.button !== 0) {
      return;
    }
    const label = optionTextById.get(optionId) ?? optionId;
    const nextDrag: DragState = {
      optionId,
      label,
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      active: false,
    };
    dragStateRef.current = nextDrag;
    setDragState(nextDrag);
    setDropTargetId(null);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onOptionPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const current = dragStateRef.current;
    if (!current || current.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - current.originX;
    const dy = event.clientY - current.originY;
    const distance = Math.hypot(dx, dy);
    const nextActive = current.active || distance >= DRAG_THRESHOLD_PX;
    const nextDrag: DragState = {
      ...current,
      x: event.clientX,
      y: event.clientY,
      active: nextActive,
    };
    dragStateRef.current = nextDrag;
    setDragState(nextDrag);
    if (nextActive) {
      setSelectedOptionId(null);
      setDropTargetId(dropTargetFromPoint(event.clientX, event.clientY));
    }
  };

  const endOptionPointer = (event: PointerEvent<HTMLButtonElement>) => {
    const current = dragStateRef.current;
    if (!current || current.pointerId !== event.pointerId) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (current.active) {
      const targetId = dropTargetFromPoint(event.clientX, event.clientY);
      if (targetId === UNASSIGNED_DROP_ID) {
        unassignOption(current.optionId);
      } else if (targetId) {
        placeOptionInTier(current.optionId, targetId);
      }
    } else {
      onSelectOption(current.optionId);
    }

    dragStateRef.current = null;
    setDragState(null);
    setDropTargetId(null);
  };

  const onSubmit = async () => {
    if (!canSubmit) {
      return;
    }
    setIsSubmitting(true);
    setStatusMessage("");
    try {
      const response = await fetch("/api/feed-post-tier-list-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          post_id: postId,
          assignment,
        }),
      });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }
      const payload = (await response.json()) as { data?: PostData | null };
      if (payload.data) {
        onTierListUpdated?.(payload.data);
      }
    } catch {
      setStatusMessage("Failed to submit tier list.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (tierList.has_submitted && tierList.results) {
    return (
      <div className="mt-3 space-y-2">
        <p className="text-xs font-semibold text-muted">Tier list · community results</p>
        <div className="space-y-2">
          {tierList.tiers.map((tier) => {
            const cells = resultsByTier.get(tier.id) ?? [];
            return (
              <div key={tier.id} className="rounded-lg border border-border bg-surface px-3 py-2">
                <p className="mb-1.5 text-sm font-semibold text-foreground">{tier.name}</p>
                {cells.length === 0 ? (
                  <p className="text-xs text-muted">No options yet</p>
                ) : (
                  <div className="space-y-1.5">
                    {cells.map((cell) => (
                      <div
                        key={`${tier.id}-${cell.optionId}`}
                        className="relative overflow-hidden rounded-md border border-border px-2 py-1.5"
                      >
                        <div
                          className="absolute inset-y-0 left-0 bg-accent/20"
                          style={{ width: `${cell.percentage}%` }}
                        />
                        <div className="relative flex items-center justify-between gap-2 text-sm">
                          <span className="min-w-0 break-words text-foreground">
                            {optionTextById.get(cell.optionId) ?? cell.optionId}
                          </span>
                          <span className="shrink-0 tabular-nums text-muted">{cell.percentage}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {tierList.total_submitters != null ? (
          <p className="text-xs text-muted">
            {tierList.total_submitters} submission
            {tierList.total_submitters === 1 ? "" : "s"}
          </p>
        ) : null}
      </div>
    );
  }

  const isDragging = Boolean(dragState?.active);
  const showUnassignedDropZone = unassignedOptions.length > 0 || isDragging;

  return (
    <div className={`mt-3 space-y-3 ${DONT_SWIPE_TABS_CLASSNAME}`}>
      <p className="text-xs font-semibold text-muted">
        Tier list · drag options into tiers (or tap)
      </p>

      <div className="space-y-2">
        {tierList.tiers.map((tier) => {
          const optionIds = optionsByTier.get(tier.id) ?? [];
          const isDropTarget = dropTargetId === tier.id;
          const isTapTarget = Boolean(selectedOptionId) && !isDragging;
          return (
            <div
              key={tier.id}
              data-tier-drop={tier.id}
              onClick={() => onSelectTier(tier.id)}
              className={`min-h-[3.25rem] rounded-lg border px-3 py-1 transition ${
                isDropTarget || isTapTarget
                  ? "border-accent/60 bg-accent/5"
                  : "border-border bg-surface"
              }`}
            >
              <p className="mb-1 text-sm font-semibold text-foreground">
                {tier.name}
                {isTapTarget ? (
                  <span className="ml-2 text-xs font-normal text-muted">Tap to place here</span>
                ) : null}
                {isDropTarget ? (
                  <span className="ml-2 text-xs font-normal text-muted">Drop here</span>
                ) : null}
              </p>
              {optionIds.length === 0 ? (
                <p className="text-xs text-muted">Empty</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {optionIds.map((optionId) => {
                    const isDragSource = dragState?.active && dragState.optionId === optionId;
                    return (
                      <button
                        key={optionId}
                        type="button"
                        onPointerDown={(event) => onOptionPointerDown(event, optionId)}
                        onPointerMove={onOptionPointerMove}
                        onPointerUp={endOptionPointer}
                        onPointerCancel={endOptionPointer}
                        onClick={(event) => {
                          event.stopPropagation();
                        }}
                        disabled={interactionLocked}
                        className={`touch-none rounded-md border border-border bg-bg px-2 py-1 text-xs text-foreground disabled:opacity-60 ${
                          isDragSource ? "opacity-40" : ""
                        }`}
                      >
                        {optionTextById.get(optionId) ?? optionId}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showUnassignedDropZone ? (
        <div
          data-tier-drop={UNASSIGNED_DROP_ID}
          className={`rounded-lg border px-3 py-2 transition ${
            dropTargetId === UNASSIGNED_DROP_ID
              ? "border-accent bg-accent/10"
              : "border-border bg-surface"
          }`}
        >
          <p className="mb-1.5 text-xs font-semibold text-muted">Unassigned</p>
          {unassignedOptions.length === 0 ? (
            <p className="text-xs text-muted">Drop here to unassign</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {unassignedOptions.map((option) => {
                const isSelected = selectedOptionId === option.id;
                const isDragSource = dragState?.active && dragState.optionId === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onPointerDown={(event) => onOptionPointerDown(event, option.id)}
                    onPointerMove={onOptionPointerMove}
                    onPointerUp={endOptionPointer}
                    onPointerCancel={endOptionPointer}
                    onClick={(event) => {
                      event.stopPropagation();
                    }}
                    disabled={interactionLocked}
                    className={`touch-none rounded-lg border px-2.5 py-1.5 text-sm transition disabled:opacity-60 ${
                      isDragSource
                        ? "opacity-40"
                        : isSelected
                          ? "border-accent bg-accent/15 text-foreground"
                          : "border-border bg-bg text-foreground"
                    }`}
                  >
                    {option.text}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {!isPreview && !tierList.has_submitted ? (
        <button
          type="button"
          onClick={() => {
            void onSubmit();
          }}
          disabled={!canSubmit}
          className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-on-accent disabled:opacity-50"
        >
          {isSubmitting ? "Submitting..." : "Submit tier list"}
        </button>
      ) : null}

      {statusMessage ? <p className="text-xs text-muted">{statusMessage}</p> : null}

      {dragState?.active ? (
        <div
          className="pointer-events-none fixed z-[3000] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-accent bg-surface px-2.5 py-1.5 text-sm text-foreground shadow-lg"
          style={{ left: dragState.x, top: dragState.y }}
        >
          {dragState.label}
        </div>
      ) : null}
    </div>
  );
}
