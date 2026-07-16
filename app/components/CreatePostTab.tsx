"use client";

import { ChangeEvent, PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Aperture, ArrowLeft, ChevronDown, Contrast, Droplets, Palette, PenBoxIcon, ImagePlus, Sun, Thermometer, X } from "lucide-react";
import {
  prepareImageForUpload,
  uploadPreparedImageToMainBucket,
} from "@/app/components/utils/client_file_storage_utils";
import { ApiError, PollDurationHours, PollSelectionMode, PollViewerState, PostGroup, PostGroupsGetResponse, PostItem } from "@/app/types/interfaces";
import { DONT_SWIPE_TABS_CLASSNAME } from "./utils/useSwipeBack";
import { PostSection } from "@/app/components/PostSection";

type CreatePostTabProps = {
  isActive: boolean;
  currentUserId: string;
  username: string;
  profileImageId: string | null;
  profileImageUrl: string | null;
  onCancel: () => void;
  onPosted: () => void;
};

type CreatePostKind = "post" | "poll";

type AudienceSelection =
  | { mode: "permanent" }
  | { mode: "all" }
  | { mode: "group"; groupId: string };

type PendingUploadImage = {
  id: string;
  previewDataUrl: string;
  base64Data: string;
  mimeType: string;
};

const POLL_DURATION_OPTIONS: Array<{ value: PollDurationHours; label: string }> = [
  { value: 12, label: "12 hours" },
  { value: 24, label: "1 day" },
  { value: 48, label: "2 days" },
  { value: 168, label: "1 week" },
];

const buildPreviewPollState = ({
  optionTexts,
  selectionMode,
  allowVoteChanges,
  durationHours,
}: {
  optionTexts: string[];
  selectionMode: PollSelectionMode;
  allowVoteChanges: boolean;
  durationHours: PollDurationHours;
}): PollViewerState => {
  const options = optionTexts
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    .map((text, index) => ({ id: `preview-option-${index}`, text }));
  const closesAt = new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString();
  return {
    options:
      options.length >= 2
        ? options
        : [
            { id: "preview-option-0", text: options[0]?.text || "Option 1" },
            { id: "preview-option-1", text: options[1]?.text || "Option 2" },
          ],
    selection_mode: selectionMode,
    allow_vote_changes: allowVoteChanges,
    closes_at: closesAt,
    has_voted: false,
    viewer_selection: [],
    is_closed: false,
    results: null,
    total_voters: null,
  };
};

type PostImageEditorModalProps = {
  isOpen: boolean;
  sourceDataUrl: string | null;
  onClose: () => void;
  onSave: (payload: { previewDataUrl: string; base64Data: string; mimeType: string }) => void;
};

type ImageAdjustmentKey =
  | "brightness"
  | "contrast"
  | "saturation"
  | "warmth"
  | "tint"
  | "vignette";

type ImageAdjustments = Record<ImageAdjustmentKey, number>;
type ImageAdjustmentOption = {
  key: ImageAdjustmentKey;
  label: string;
  min: number;
  max: number;
  step: number;
  icon: typeof Sun;
};

const PREVIEW_SIZE_PX = 280;
const OUTPUT_SIZE_PX = 1024;
const DEFAULT_ADJUSTMENTS: ImageAdjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
  tint: 0,
  vignette: 0,
};
const ADJUSTMENT_OPTIONS: ImageAdjustmentOption[] = [
  { key: "brightness", label: "Brightness", min: -100, max: 100, step: 1, icon: Sun },
  { key: "contrast", label: "Contrast", min: -100, max: 100, step: 1, icon: Contrast },
  { key: "saturation", label: "Saturation", min: -100, max: 100, step: 1, icon: Droplets },
  { key: "warmth", label: "Warmth", min: -100, max: 100, step: 1, icon: Thermometer },
  { key: "tint", label: "Tint", min: -100, max: 100, step: 1, icon: Palette },
  { key: "vignette", label: "Vignette", min: 0, max: 100, step: 1, icon: Aperture },
];

const buildCanvasFilter = (adjustments: ImageAdjustments): string => {
  const brightness = 100 + adjustments.brightness * 0.8;
  const contrast = 100 + adjustments.contrast * 0.9;
  const saturation = 100 + adjustments.saturation;
  const warmth = adjustments.warmth / 100;
  const tintDegrees = (adjustments.tint / 100) * 28;

  const warmthSepia = Math.max(0, warmth) * 38;
  const warmthHueRotate = warmth >= 0 ? -warmth * 14 : -warmth * 18;

  return [
    `brightness(${brightness}%)`,
    `contrast(${contrast}%)`,
    `saturate(${saturation}%)`,
    `sepia(${warmthSepia}%)`,
    `hue-rotate(${warmthHueRotate + tintDegrees}deg)`,
  ].join(" ");
};

function PostImageEditorModal({ isOpen, sourceDataUrl, onClose, onSave }: PostImageEditorModalProps) {
  const [imageElement, setImageElement] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [activeAdjustment, setActiveAdjustment] = useState<ImageAdjustmentKey>("brightness");
  const [adjustments, setAdjustments] = useState<ImageAdjustments>(DEFAULT_ADJUSTMENTS);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const dragStartRef = useRef<{ x: number; y: number; startOffsetX: number; startOffsetY: number } | null>(null);

  useEffect(() => {
    if (!isOpen || !sourceDataUrl) {
      setImageElement(null);
      setZoom(1);
      setActiveAdjustment("brightness");
      setAdjustments(DEFAULT_ADJUSTMENTS);
      setOffsetX(0);
      setOffsetY(0);
      setIsDragging(false);
      setStatusMessage("");
      return;
    }

    const image = new Image();
    image.onload = () => {
      setImageElement(image);
      setZoom(1);
      setActiveAdjustment("brightness");
      setAdjustments(DEFAULT_ADJUSTMENTS);
      setOffsetX(0);
      setOffsetY(0);
      setStatusMessage("");
    };
    image.onerror = () => {
      setImageElement(null);
      setStatusMessage("Failed to load image.");
    };
    image.src = sourceDataUrl;
  }, [isOpen, sourceDataUrl]);

  const baseScale = useMemo(() => {
    if (!imageElement) {
      return 1;
    }
    return Math.max(PREVIEW_SIZE_PX / imageElement.naturalWidth, PREVIEW_SIZE_PX / imageElement.naturalHeight);
  }, [imageElement]);

  const displayedSize = useMemo(() => {
    if (!imageElement) {
      return { width: PREVIEW_SIZE_PX, height: PREVIEW_SIZE_PX };
    }
    return {
      width: imageElement.naturalWidth * baseScale * zoom,
      height: imageElement.naturalHeight * baseScale * zoom,
    };
  }, [baseScale, imageElement, zoom]);

  const clampOffsets = useCallback(
    (nextX: number, nextY: number): { x: number; y: number } => {
      const maxX = Math.max(0, (displayedSize.width - PREVIEW_SIZE_PX) / 2);
      const maxY = Math.max(0, (displayedSize.height - PREVIEW_SIZE_PX) / 2);
      return {
        x: Math.max(-maxX, Math.min(maxX, nextX)),
        y: Math.max(-maxY, Math.min(maxY, nextY)),
      };
    },
    [displayedSize.height, displayedSize.width],
  );

  useEffect(() => {
    const clamped = clampOffsets(offsetX, offsetY);
    if (clamped.x !== offsetX) {
      setOffsetX(clamped.x);
    }
    if (clamped.y !== offsetY) {
      setOffsetY(clamped.y);
    }
  }, [clampOffsets, offsetX, offsetY]);

  const activeAdjustmentOption = ADJUSTMENT_OPTIONS.find((option) => option.key === activeAdjustment) ?? ADJUSTMENT_OPTIONS[0];
  const activeAdjustmentValue = adjustments[activeAdjustmentOption.key];
  const previewFilter = useMemo(() => buildCanvasFilter(adjustments), [adjustments]);
  const vignetteOpacity = (adjustments.vignette / 100) * 0.72;

  const onPointerDownPreview = (event: PointerEvent<HTMLDivElement>) => {
    if (!imageElement) {
      return;
    }
    setIsDragging(true);
    dragStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      startOffsetX: offsetX,
      startOffsetY: offsetY,
    };
  };

  const onPointerMovePreview = (event: PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !dragStartRef.current) {
      return;
    }
    const dx = event.clientX - dragStartRef.current.x;
    const dy = event.clientY - dragStartRef.current.y;
    const clamped = clampOffsets(dragStartRef.current.startOffsetX + dx, dragStartRef.current.startOffsetY + dy);
    setOffsetX(clamped.x);
    setOffsetY(clamped.y);
  };

  const onPointerUpPreview = () => {
    setIsDragging(false);
    dragStartRef.current = null;
  };

  const onSaveEditedImage = () => {
    if (!imageElement) {
      return;
    }

    const outputBaseScale = Math.max(
      OUTPUT_SIZE_PX / imageElement.naturalWidth,
      OUTPUT_SIZE_PX / imageElement.naturalHeight,
    );
    const drawWidth = imageElement.naturalWidth * outputBaseScale * zoom;
    const drawHeight = imageElement.naturalHeight * outputBaseScale * zoom;
    const offsetRatio = OUTPUT_SIZE_PX / PREVIEW_SIZE_PX;
    const drawX = (OUTPUT_SIZE_PX - drawWidth) / 2 + offsetX * offsetRatio;
    const drawY = (OUTPUT_SIZE_PX - drawHeight) / 2 + offsetY * offsetRatio;

    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_SIZE_PX;
    canvas.height = OUTPUT_SIZE_PX;
    const context = canvas.getContext("2d");
    if (!context) {
      setStatusMessage("Failed to prepare edited image.");
      return;
    }
    context.filter = buildCanvasFilter(adjustments);
    context.drawImage(imageElement, drawX, drawY, drawWidth, drawHeight);
    context.filter = "none";
    if (adjustments.vignette > 0) {
      const centerX = OUTPUT_SIZE_PX / 2;
      const centerY = OUTPUT_SIZE_PX / 2;
      const radius = OUTPUT_SIZE_PX * 0.72;
      const gradient = context.createRadialGradient(centerX, centerY, OUTPUT_SIZE_PX * 0.22, centerX, centerY, radius);
      gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
      gradient.addColorStop(1, `rgba(0, 0, 0, ${(adjustments.vignette / 100) * 0.72})`);
      context.fillStyle = gradient;
      context.fillRect(0, 0, OUTPUT_SIZE_PX, OUTPUT_SIZE_PX);
    }

    const previewDataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const base64Data = previewDataUrl.split(",")[1];
    if (!base64Data) {
      setStatusMessage("Failed to encode edited image.");
      return;
    }

    onSave({ previewDataUrl, base64Data, mimeType: "image/jpeg" });
    onClose();
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-xl border border-accent-1 bg-secondary-background p-3 shadow-xl shadow-black/35">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Edit Image</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-accent-1 px-2 py-1 text-sm text-accent-2 hover:text-foreground"
          >
            Close
          </button>
        </div>

        {sourceDataUrl && imageElement ? (
          <>
            <div
              className="relative mx-auto h-[280px] w-[280px] overflow-hidden rounded-lg border border-accent-1 bg-primary-background touch-none"
              onPointerDown={onPointerDownPreview}
              onPointerMove={onPointerMovePreview}
              onPointerUp={onPointerUpPreview}
              onPointerCancel={onPointerUpPreview}
              onPointerLeave={onPointerUpPreview}
            >
              <img
                src={sourceDataUrl}
                alt="Post image crop preview"
                draggable={false}
                className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
                style={{
                  width: `${imageElement.naturalWidth * baseScale * zoom}px`,
                  height: `${imageElement.naturalHeight * baseScale * zoom}px`,
                  transform: `translate(-50%, -50%) translate(${offsetX}px, ${offsetY}px)`,
                  filter: previewFilter,
                }}
              />
              {adjustments.vignette > 0 ? (
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{
                    background:
                      "radial-gradient(circle at center, rgba(0,0,0,0) 45%, rgba(0,0,0,var(--vignette-opacity)) 100%)",
                    ["--vignette-opacity" as string]: `${vignetteOpacity}`,
                  }}
                />
              ) : null}
            </div>
            <p className="mt-2 text-center text-xs text-accent-2">Drag to pan, use slider to zoom.</p>
            <div className="mt-2 space-y-1">
              <label className="text-xs text-accent-2">Zoom</label>
              <input
                type="range"
                min={1}
                max={3}
                step={0.01}
                value={zoom}
                onChange={(event) => {
                  setZoom(Number(event.target.value));
                }}
                className="w-full"
              />
            </div>
            <div className="mt-3 rounded-lg border border-accent-1 bg-primary-background p-2">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold text-foreground">{activeAdjustmentOption.label}</p>
                <p className="text-xs text-accent-2">{activeAdjustmentValue > 0 ? `+${activeAdjustmentValue}` : activeAdjustmentValue}</p>
              </div>
              <input
                type="range"
                min={activeAdjustmentOption.min}
                max={activeAdjustmentOption.max}
                step={activeAdjustmentOption.step}
                value={activeAdjustmentValue}
                onChange={(event) => {
                  const nextValue = Number(event.target.value);
                  setAdjustments((previous) => ({
                    ...previous,
                    [activeAdjustmentOption.key]: nextValue,
                  }));
                }}
                className="w-full"
              />
            </div>
            <div className="mt-2 overflow-x-auto pb-1">
              <div className="flex w-max gap-3">
                {ADJUSTMENT_OPTIONS.map((option) => (
                  (() => {
                    const Icon = option.icon;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => setActiveAdjustment(option.key)}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition ${option.key === activeAdjustment
                            ? "border-accent-3 bg-accent-3 text-primary-background"
                            : "border-accent-1 bg-primary-background text-accent-2 hover:text-foreground"
                          }`}
                      >
                        <Icon className="h-6 w-4" />
                      </button>
                    );
                  })()
                ))}
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 text-sm">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-lg border border-accent-1 px-3 py-2 text-accent-2 hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdjustments(DEFAULT_ADJUSTMENTS);
                  setActiveAdjustment("brightness");
                }}
                className="flex-1 rounded-lg border border-accent-1 px-3 py-2 text-accent-2 hover:text-foreground"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={onSaveEditedImage}
                className="flex-1 rounded-lg bg-accent-3 px-3 py-2 font-semibold text-primary-background"
              >
                Save
              </button>
            </div>
          </>
        ) : (
          <p className="py-10 text-center text-xs text-accent-2">Loading image...</p>
        )}

        {statusMessage ? <p className="mt-2 text-xs text-accent-2">{statusMessage}</p> : null}
      </div>
    </div>
  );
}

const postWithAuth = async (path: string, body: unknown): Promise<Response> =>
  fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as ApiError;
    return body.error?.message ?? "Request failed.";
  } catch {
    return "Request failed.";
  }
};

export default function CreatePostTab({
  isActive,
  currentUserId,
  username,
  profileImageId,
  profileImageUrl,
  onCancel,
  onPosted,
}: CreatePostTabProps) {
  const createInputRef = useRef<HTMLInputElement | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [postKind, setPostKind] = useState<CreatePostKind>("post");
  const [comment, setComment] = useState("");
  const [images, setImages] = useState<PendingUploadImage[]>([]);
  const [editingImageId, setEditingImageId] = useState<string | null>(null);
  const [isPosting, setIsPosting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [postGroups, setPostGroups] = useState<PostGroup[]>([]);
  const [audience, setAudience] = useState<AudienceSelection>({ mode: "permanent" });
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const [pollSelectionMode, setPollSelectionMode] = useState<PollSelectionMode>("single");
  const [pollAllowVoteChanges, setPollAllowVoteChanges] = useState(false);
  const [pollDurationHours, setPollDurationHours] = useState<PollDurationHours>(24);
  const editingImage = editingImageId ? images.find((image) => image.id === editingImageId) ?? null : null;

  useEffect(() => {
    if (!isActive) {
      return;
    }
    window.setTimeout(() => {
      textInputRef.current?.focus();
    }, 0);
  }, [isActive]);

  useEffect(() => {
    if (postKind === "poll" && images.length > 1) {
      setImages((previous) => previous.slice(0, 1));
    }
  }, [postKind, images.length]);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await postWithAuth("/api/post-groups-get", {});
        if (!response.ok || cancelled) {
          return;
        }
        const payload = (await response.json()) as PostGroupsGetResponse;
        if (cancelled) {
          return;
        }
        setPostGroups(payload.groups);
      } catch {
        // Audience picker still works with permanent / all.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isActive]);

  useEffect(() => {
    if (audience.mode !== "group") {
      return;
    }
    if (!postGroups.some((group) => group.id === audience.groupId)) {
      setAudience({ mode: "permanent" });
    }
  }, [audience, postGroups]);

  const audienceHint = useMemo(() => {
    if (audience.mode === "permanent") {
      return "Visible to all current and future friends.";
    }
    if (audience.mode === "all") {
      return "Visible only to people who are friends right now.";
    }
    const group = postGroups.find((entry) => entry.id === audience.groupId);
    if (!group) {
      return "Pick a group.";
    }
    if (group.member_ids.length === 0) {
      return "This group has no members — only you will see the post.";
    }
    return `Visible to ${group.member_ids.length} friend${group.member_ids.length === 1 ? "" : "s"} in “${group.name}”.`;
  }, [audience, postGroups]);

  const onSelectAudience = (value: string) => {
    if (value === "permanent") {
      setAudience({ mode: "permanent" });
      return;
    }
    if (value === "all") {
      setAudience({ mode: "all" });
      return;
    }
    if (value.startsWith("group:")) {
      setAudience({ mode: "group", groupId: value.slice("group:".length) });
    }
  };

  const audienceSelectValue =
    audience.mode === "group" ? `group:${audience.groupId}` : audience.mode;

  const filledPollOptions = useMemo(
    () => pollOptions.map((option) => option.trim()).filter((option) => option.length > 0),
    [pollOptions],
  );
  const hasValidPoll = postKind === "poll" && filledPollOptions.length >= 2;
  const hasPreviewContent =
    comment.trim().length > 0 || images.length > 0 || (postKind === "poll" && filledPollOptions.length > 0);

  const canSubmit =
    postKind === "poll"
      ? hasValidPoll && !isPosting
      : (images.length > 0 || comment.trim().length > 0) && !isPosting;

  const previewPost = useMemo((): PostItem => {
    const otherImageIds =
      postKind === "post" && images.length > 1
        ? images.slice(1).map((_, index) => `preview-${index + 1}`)
        : undefined;
    const poll =
      postKind === "poll"
        ? buildPreviewPollState({
            optionTexts: pollOptions,
            selectionMode: pollSelectionMode,
            allowVoteChanges: pollAllowVoteChanges,
            durationHours: pollDurationHours,
          })
        : undefined;
    return {
      id: "create-post-preview",
      created_at: new Date().toISOString(),
      created_by: currentUserId,
      image_id: images.length > 0 ? "preview-0" : null,
      image_url: null,
      text: comment,
      data: {
        ...(otherImageIds ? { other_image_ids: otherImageIds } : {}),
        ...(poll ? { poll } : {}),
      },
      like_count: 0,
      is_liked_by_viewer: false,
      username,
      email: null,
      author_profile_image_id: profileImageId,
      author_profile_image_url: profileImageUrl,
    };
  }, [
    comment,
    currentUserId,
    images,
    pollAllowVoteChanges,
    pollDurationHours,
    pollOptions,
    pollSelectionMode,
    postKind,
    profileImageId,
    profileImageUrl,
    username,
  ]);

  const previewImageUrls = useMemo(
    () => images.map((image) => image.previewDataUrl),
    [images],
  );

  const onSelectPostImages = async (event: ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (fileList.length === 0) {
      return;
    }

    setStatusMessage("");
    try {
      const prepared = await Promise.all(
        fileList.map(async (file) => {
          const preparedImage = await prepareImageForUpload(file);
          return {
            id: crypto.randomUUID(),
            previewDataUrl: preparedImage.previewDataUrl,
            base64Data: preparedImage.base64Data,
            mimeType: preparedImage.mimeType,
          } satisfies PendingUploadImage;
        }),
      );
      setImages((previous) => {
        if (postKind === "poll") {
          return prepared.slice(0, 1);
        }
        return [...previous, ...prepared];
      });
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to prepare image.");
    }
  };

  const onPost = async () => {
    if (!canSubmit) {
      return;
    }

    if (postKind === "poll" && filledPollOptions.length < 2) {
      setStatusMessage("Add at least 2 poll options.");
      return;
    }

    setIsPosting(true);
    setStatusMessage("");
    try {
      const imagesToUpload = postKind === "poll" ? images.slice(0, 1) : images;
      const uploadedImageIds: string[] = [];
      for (const image of imagesToUpload) {
        const payload = await uploadPreparedImageToMainBucket(
          {
            base64Data: image.base64Data,
            mimeType: image.mimeType,
            previewDataUrl: image.previewDataUrl,
          },
          postWithAuth,
        );
        if (!payload.image_id) {
          setStatusMessage("Image upload failed.");
          return;
        }
        uploadedImageIds.push(payload.image_id);
      }

      const [primaryImageId, ...otherImageIds] = uploadedImageIds;
      const hasCommentText = comment.trim().length > 0;
      const dataPayload =
        postKind === "poll"
          ? {
              poll: {
                options: filledPollOptions.map((text) => ({ text })),
                selection_mode: pollSelectionMode,
                allow_vote_changes: pollAllowVoteChanges,
                duration_hours: pollDurationHours,
              },
            }
          : otherImageIds.length > 0
            ? { other_image_ids: otherImageIds }
            : undefined;

      const createResponse = await postWithAuth("/api/post-create", {
        ...(hasCommentText ? { text: comment } : {}),
        ...(primaryImageId ? { image_id: primaryImageId } : {}),
        ...(dataPayload ? { data: dataPayload } : {}),
        audience:
          audience.mode === "group"
            ? { mode: "group", group_id: audience.groupId }
            : { mode: audience.mode },
      });
      if (!createResponse.ok) {
        setStatusMessage(await readErrorMessage(createResponse));
        return;
      }

      setComment("");
      setImages([]);
      setAudience({ mode: "permanent" });
      setPollOptions(["", ""]);
      setPollSelectionMode("single");
      setPollAllowVoteChanges(false);
      setPollDurationHours(24);
      setPostKind("post");
      onPosted();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to create post.");
    } finally {
      setIsPosting(false);
    }
  };

  const showAddImageTile = !(postKind === "poll" && images.length >= 1);
  const imageTiles = showAddImageTile
    ? [{ id: "ADD", previewDataUrl: "ADD" } as PendingUploadImage, ...images]
    : images;

  return (
    <div className={`flex h-full min-h-0 w-full flex-col bg-primary-background ${DONT_SWIPE_TABS_CLASSNAME}`}>
      <div className="flex items-center justify-between border-b border-accent-1 px-3 py-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full flex items-center gap-2 px-3 py-2 text-sm text-accent-2 hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
          Cancel
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-3 pb-24">
        <PostImageEditorModal
          isOpen={Boolean(editingImage)}
          sourceDataUrl={editingImage?.previewDataUrl ?? null}
          onClose={() => setEditingImageId(null)}
          onSave={({ previewDataUrl, base64Data, mimeType }) => {
            if (!editingImageId) {
              return;
            }
            setImages((previous) =>
              previous.map((image) =>
                image.id === editingImageId ? { ...image, previewDataUrl, base64Data, mimeType } : image,
              ),
            );
          }}
        />

        <input
          ref={createInputRef}
          type="file"
          accept="image/*"
          multiple={postKind === "post"}
          onChange={onSelectPostImages}
          className="hidden"
        />

        <div className="mb-3 flex gap-2">
          {([
            { kind: "post", label: "Post" },
            { kind: "poll", label: "Poll" },
          ] as const).map((entry) => (
            <button
              key={entry.kind}
              type="button"
              onClick={() => setPostKind(entry.kind)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                postKind === entry.kind
                  ? "border-accent-3 bg-accent-3 text-primary-background"
                  : "border-accent-1 bg-secondary-background text-accent-2 hover:text-foreground"
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="mb-3">
          <label htmlFor="post-audience" className="mb-1 block text-xs font-semibold text-accent-2">
            Who can see this {postKind === "poll" ? "poll" : "post"}?
          </label>
          <div className="relative">
            <select
              id="post-audience"
              value={audienceSelectValue}
              onChange={(event) => onSelectAudience(event.target.value)}
              className="w-full appearance-none rounded-lg border border-accent-1 bg-secondary-background px-3 py-2 pr-10 text-sm text-foreground outline-none focus:border-accent-2"
            >
              <option value="permanent">All friends (including future)</option>
              <option value="all">All friends right now</option>
              {postGroups.map((group) => (
                <option key={group.id} value={`group:${group.id}`}>
                  {group.name} ({group.member_ids.length})
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-accent-2" />
          </div>
          <p className="mt-1 text-xs text-accent-2">{audienceHint}</p>
        </div>

        <div className="-mx-1 pt-3 w-[calc(100%+0.5rem)] overflow-x-auto">
          <div className="flex w-max flex-nowrap gap-2 px-1">
            {imageTiles.map((image) => (
              <div
                key={image.id}
                className="relative aspect-square h-32 flex-none overflow-hidden rounded-lg border border-accent-1 sm:h-36"
              >
                {image.id === "ADD" ? (
                  <button
                    type="button"
                    onClick={() => createInputRef.current?.click()}
                    className="mb-3 w-full h-full inline-flex items-center gap-2 rounded-lg border border-accent-1 bg-secondary-background px-3 py-2 text-sm text-accent-3 hover:text-foreground"
                  >
                    <div className="w-full">
                      <ImagePlus className="h-10 w-10 w-full" />
                      <div>{postKind === "poll" ? "Add photo" : "Add photos"}</div>
                    </div>
                  </button>
                ) : (
                  <>
                    <img src={image.previewDataUrl} alt="New post preview" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setEditingImageId(image.id)}
                      className="absolute left-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80 opacity-50"
                      aria-label="Tap to edit image"
                      title="Tap to edit"
                    >
                      <PenBoxIcon className="h-6 w-6" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setImages((previous) => {
                          const nextImages = previous.filter((row) => row.id !== image.id);
                          if (editingImageId === image.id) {
                            setEditingImageId(null);
                          }
                          return nextImages;
                        })
                      }
                      className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white hover:bg-black/80 opacity-50"
                      aria-label="Remove image"
                    >
                      <X className="h-6 w-6" />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-7">
          <textarea
            ref={textInputRef}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder={postKind === "poll" ? "Ask a question..." : "Write a comment..."}
            className="min-h-[20vh] max-h-[20vh] w-full rounded-lg border border-accent-1 bg-secondary-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent-2"
          />
        </div>

        {postKind === "poll" ? (
          <div className="mt-4 space-y-4">
            <div>
              <p className="mb-2 text-xs font-semibold text-accent-2">Options (2–10)</p>
              <div className="space-y-2">
                {pollOptions.map((option, index) => (
                  <div key={`poll-option-${index}`} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={option}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setPollOptions((previous) =>
                          previous.map((entry, entryIndex) =>
                            entryIndex === index ? nextValue : entry,
                          ),
                        );
                      }}
                      placeholder={`Option ${index + 1}`}
                      maxLength={200}
                      className="w-full rounded-lg border border-accent-1 bg-secondary-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent-2"
                    />
                    {pollOptions.length > 2 ? (
                      <button
                        type="button"
                        onClick={() =>
                          setPollOptions((previous) => previous.filter((_, entryIndex) => entryIndex !== index))
                        }
                        className="rounded-lg border border-accent-1 px-2 py-2 text-accent-2 hover:text-foreground"
                        aria-label={`Remove option ${index + 1}`}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
              {pollOptions.length < 10 ? (
                <button
                  type="button"
                  onClick={() => setPollOptions((previous) => [...previous, ""])}
                  className="mt-2 text-sm font-semibold text-accent-3 hover:brightness-110"
                >
                  + Add option
                </button>
              ) : null}
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold text-accent-2">Selection</p>
              <div className="flex gap-2">
                {([
                  { mode: "single", label: "One choice" },
                  { mode: "multiple", label: "Multiple choices" },
                ] as const).map((entry) => (
                  <button
                    key={entry.mode}
                    type="button"
                    onClick={() => setPollSelectionMode(entry.mode)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm transition ${
                      pollSelectionMode === entry.mode
                        ? "border-accent-3 bg-accent-3/20 text-foreground"
                        : "border-accent-1 bg-secondary-background text-accent-2"
                    }`}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={pollAllowVoteChanges}
                onChange={(event) => setPollAllowVoteChanges(event.target.checked)}
                className="h-4 w-4"
              />
              Allow changing votes before the poll closes
            </label>

            <div>
              <label htmlFor="poll-duration" className="mb-1 block text-xs font-semibold text-accent-2">
                Duration
              </label>
              <div className="relative">
                <select
                  id="poll-duration"
                  value={pollDurationHours}
                  onChange={(event) =>
                    setPollDurationHours(Number(event.target.value) as PollDurationHours)
                  }
                  className="w-full appearance-none rounded-lg border border-accent-1 bg-secondary-background px-3 py-2 pr-10 text-sm text-foreground outline-none focus:border-accent-2"
                >
                  {POLL_DURATION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-accent-2" />
              </div>
            </div>
          </div>
        ) : null}

        {hasPreviewContent ? (
          <div className="mt-7">
            <p className="mb-2 text-xs font-semibold text-accent-2">Preview</p>
            <PostSection
              post={previewPost}
              currentUserId={currentUserId}
              previewImageUrls={previewImageUrls}
              isPreview
              disableCommentSendInput={true}
              className="rounded-lg border border-accent-1"
            />
          </div>
        ) : null}

        {statusMessage ? <p className="mt-2 text-xs text-accent-2">{statusMessage}</p> : null}
      </div>

      <div className="absolute bottom-4 right-4">
        <button
          type="button"
          onClick={onPost}
          style={{ boxShadow: "0 0 10px 2px rgba(0, 0, 0, 1)" }}
          disabled={!canSubmit}
          className="rounded-xl bg-accent-3 px-6 py-3 text-base font-semibold text-primary-background transition hover:brightness-110 disabled:opacity-50"
        >
          {isPosting ? "Posting..." : "Post ->"}
        </button>
      </div>
    </div>
  );
}
