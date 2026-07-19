"use client";

import { ChangeEvent, PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Aperture,
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Contrast,
  Crop,
  Droplets,
  ImagePlus,
  Palette,
  Sun,
  Thermometer,
  X,
} from "lucide-react";
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

type ImageAdjustmentKey =
  | "crop"
  | "brightness"
  | "contrast"
  | "saturation"
  | "warmth"
  | "tint"
  | "vignette";

type ImageAdjustments = {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
  tint: number;
  vignette: number;
};
type ImageAdjustmentOption = {
  key: ImageAdjustmentKey;
  label: string;
  min: number;
  max: number;
  step: number;
  icon: typeof Sun;
};

type ImageEditDraft = {
  zoom: number;
  offsetX: number;
  offsetY: number;
  adjustments: ImageAdjustments;
};

const POLL_DURATION_OPTIONS: Array<{ value: PollDurationHours; label: string }> = [
  { value: 12, label: "12 hours" },
  { value: 24, label: "1 day" },
  { value: 48, label: "2 days" },
  { value: 168, label: "1 week" },
];

const PREVIEW_SIZE_PX = 384;
const OUTPUT_SIZE_PX = 1024;
const SWIPE_PAGE_THRESHOLD_PX = 48;
const DEFAULT_ADJUSTMENTS: ImageAdjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
  tint: 0,
  vignette: 0,
};
const DEFAULT_EDIT_DRAFT: ImageEditDraft = {
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  adjustments: DEFAULT_ADJUSTMENTS,
};
const ADJUSTMENT_OPTIONS: ImageAdjustmentOption[] = [
  { key: "crop", label: "Crop", min: 1, max: 3, step: 0.01, icon: Crop },
  { key: "brightness", label: "Brightness", min: -100, max: 100, step: 1, icon: Sun },
  { key: "contrast", label: "Contrast", min: -100, max: 100, step: 1, icon: Contrast },
  { key: "saturation", label: "Saturation", min: -100, max: 100, step: 1, icon: Droplets },
  { key: "warmth", label: "Warmth", min: -100, max: 100, step: 1, icon: Thermometer },
  { key: "tint", label: "Tint", min: -100, max: 100, step: 1, icon: Palette },
  { key: "vignette", label: "Vignette", min: 0, max: 100, step: 1, icon: Aperture },
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

const createDefaultEditDraft = (): ImageEditDraft => ({
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  adjustments: { ...DEFAULT_ADJUSTMENTS },
});

const loadImageElement = (sourceDataUrl: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load image."));
    image.src = sourceDataUrl;
  });

const clampDraftOffsets = ({
  naturalWidth,
  naturalHeight,
  zoom,
  offsetX,
  offsetY,
}: {
  naturalWidth: number;
  naturalHeight: number;
  zoom: number;
  offsetX: number;
  offsetY: number;
}): { x: number; y: number } => {
  const baseScale = Math.max(PREVIEW_SIZE_PX / naturalWidth, PREVIEW_SIZE_PX / naturalHeight);
  const displayedWidth = naturalWidth * baseScale * zoom;
  const displayedHeight = naturalHeight * baseScale * zoom;
  const maxX = Math.max(0, (displayedWidth - PREVIEW_SIZE_PX) / 2);
  const maxY = Math.max(0, (displayedHeight - PREVIEW_SIZE_PX) / 2);
  return {
    x: Math.max(-maxX, Math.min(maxX, offsetX)),
    y: Math.max(-maxY, Math.min(maxY, offsetY)),
  };
};

const bakeEditedImage = async ({
  sourceDataUrl,
  draft,
}: {
  sourceDataUrl: string;
  draft: ImageEditDraft;
}): Promise<{ previewDataUrl: string; base64Data: string; mimeType: string }> => {
  const imageElement = await loadImageElement(sourceDataUrl);
  const { zoom, adjustments } = draft;
  const clamped = clampDraftOffsets({
    naturalWidth: imageElement.naturalWidth,
    naturalHeight: imageElement.naturalHeight,
    zoom,
    offsetX: draft.offsetX,
    offsetY: draft.offsetY,
  });

  const outputBaseScale = Math.max(
    OUTPUT_SIZE_PX / imageElement.naturalWidth,
    OUTPUT_SIZE_PX / imageElement.naturalHeight,
  );
  const drawWidth = imageElement.naturalWidth * outputBaseScale * zoom;
  const drawHeight = imageElement.naturalHeight * outputBaseScale * zoom;
  const offsetRatio = OUTPUT_SIZE_PX / PREVIEW_SIZE_PX;
  const drawX = (OUTPUT_SIZE_PX - drawWidth) / 2 + clamped.x * offsetRatio;
  const drawY = (OUTPUT_SIZE_PX - drawHeight) / 2 + clamped.y * offsetRatio;

  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE_PX;
  canvas.height = OUTPUT_SIZE_PX;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to prepare edited image.");
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
    throw new Error("Failed to encode edited image.");
  }
  return { previewDataUrl, base64Data, mimeType: "image/jpeg" };
};

const slideTransformForDistance = (distance: number): { transform: string; opacity: number; zIndex: number } => {
  const absDistance = Math.abs(distance);
  if (absDistance > 2) {
    return { transform: "translate(-50%, -50%) scale(0.55)", opacity: 0, zIndex: 0 };
  }
  // Neighbors sit beside the active page like a book stack (peek ~1/4 of the stage).
  const translateX = distance * 48;
  const rotateY = distance * -26;
  const scale = distance === 0 ? 1 : Math.max(0.72, 0.86 - absDistance * 0.08);
  const translateZ = distance === 0 ? 56 : -absDistance * 80;
  return {
    transform: `translate(-50%, -50%) translateX(${translateX}%) translateZ(${translateZ}px) rotateY(${rotateY}deg) scale(${scale})`,
    opacity: 1,
    zIndex: 20 - absDistance,
  };
};

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
  const [imageEditDrafts, setImageEditDrafts] = useState<Record<string, ImageEditDraft>>({});
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeAdjustment, setActiveAdjustment] = useState<ImageAdjustmentKey>("brightness");
  const [imageSizes, setImageSizes] = useState<Record<string, { width: number; height: number }>>({});
  const [isPosting, setIsPosting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [postGroups, setPostGroups] = useState<PostGroup[]>([]);
  const [audience, setAudience] = useState<AudienceSelection>({ mode: "permanent" });
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const [pollSelectionMode, setPollSelectionMode] = useState<PollSelectionMode>("single");
  const [pollAllowVoteChanges, setPollAllowVoteChanges] = useState(false);
  const [pollDurationHours, setPollDurationHours] = useState<PollDurationHours>(24);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const cropDragStartRef = useRef<{ x: number; y: number; startOffsetX: number; startOffsetY: number } | null>(null);
  const pinchStartRef = useRef<{ distance: number; zoom: number; offsetX: number; offsetY: number } | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);

  const activeImage = images[activeIndex] ?? null;
  const activeDraft = activeImage
    ? imageEditDrafts[activeImage.id] ?? DEFAULT_EDIT_DRAFT
    : DEFAULT_EDIT_DRAFT;
  const cropMode = activeAdjustment === "crop";

  const exitCropTool = useCallback(() => {
    setActiveAdjustment((previous) => (previous === "crop" ? "brightness" : previous));
  }, []);

  const goToIndex = useCallback((nextIndex: number) => {
    const clamped = Math.max(0, Math.min(images.length - 1, nextIndex));
    setActiveIndex((previous) => {
      if (clamped !== previous) {
        exitCropTool();
      }
      return clamped;
    });
  }, [exitCropTool, images.length]);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    window.setTimeout(() => {
      textInputRef.current?.focus();
    }, 0);
  }, [isActive]);

  useEffect(() => {
    if (images.length === 0) {
      setActiveIndex(0);
      exitCropTool();
      return;
    }
    if (activeIndex > images.length - 1) {
      setActiveIndex(images.length - 1);
      exitCropTool();
    }
  }, [activeIndex, exitCropTool, images.length]);

  const activeImageSize = activeImage ? imageSizes[activeImage.id] ?? null : null;

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      images.map(async (image) => {
        try {
          const loaded = await loadImageElement(image.previewDataUrl);
          return {
            id: image.id,
            width: loaded.naturalWidth,
            height: loaded.naturalHeight,
          };
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (cancelled) {
        return;
      }
      setImageSizes((previous) => {
        const next = { ...previous };
        let changed = false;
        for (const result of results) {
          if (!result) {
            continue;
          }
          const existing = next[result.id];
          if (!existing || existing.width !== result.width || existing.height !== result.height) {
            next[result.id] = { width: result.width, height: result.height };
            changed = true;
          }
        }
        const liveIds = new Set(images.map((image) => image.id));
        for (const id of Object.keys(next)) {
          if (!liveIds.has(id)) {
            delete next[id];
            changed = true;
          }
        }
        return changed ? next : previous;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [images]);

  useEffect(() => {
    if (!activeImage || !activeImageSize) {
      return;
    }
    const clamped = clampDraftOffsets({
      naturalWidth: activeImageSize.width,
      naturalHeight: activeImageSize.height,
      zoom: activeDraft.zoom,
      offsetX: activeDraft.offsetX,
      offsetY: activeDraft.offsetY,
    });
    if (clamped.x === activeDraft.offsetX && clamped.y === activeDraft.offsetY) {
      return;
    }
    setImageEditDrafts((previous) => ({
      ...previous,
      [activeImage.id]: {
        ...(previous[activeImage.id] ?? createDefaultEditDraft()),
        offsetX: clamped.x,
        offsetY: clamped.y,
      },
    }));
  }, [activeDraft.offsetX, activeDraft.offsetY, activeDraft.zoom, activeImage, activeImageSize]);

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
      images.length > 1
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

  const updateActiveDraft = (patch: Partial<ImageEditDraft>) => {
    if (!activeImage) {
      return;
    }
    setImageEditDrafts((previous) => {
      const current = previous[activeImage.id] ?? createDefaultEditDraft();
      return {
        ...previous,
        [activeImage.id]: {
          ...current,
          ...patch,
          adjustments: patch.adjustments ?? current.adjustments,
        },
      };
    });
  };

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
      setImages((previous) => [...previous, ...prepared]);
      setImageEditDrafts((previous) => {
        const nextDrafts = { ...previous };
        for (const image of prepared) {
          nextDrafts[image.id] = createDefaultEditDraft();
        }
        return nextDrafts;
      });
      setActiveIndex(images.length);
      exitCropTool();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to prepare image.");
    }
  };

  const onRemoveActiveImage = () => {
    if (!activeImage) {
      return;
    }
    const removedId = activeImage.id;
    const nextImages = images.filter((row) => row.id !== removedId);
    setImages(nextImages);
    setImageEditDrafts((previous) => {
      const nextDrafts = { ...previous };
      delete nextDrafts[removedId];
      return nextDrafts;
    });
    exitCropTool();
    setActiveIndex((previous) => Math.max(0, Math.min(previous, nextImages.length - 1)));
  };

  const beginCropGestureFromPointers = () => {
    if (!activeImage) {
      return;
    }
    const points = [...pointersRef.current.values()];
    if (points.length >= 2) {
      cropDragStartRef.current = null;
      const [first, second] = points;
      pinchStartRef.current = {
        distance: Math.hypot(first.x - second.x, first.y - second.y),
        zoom: activeDraft.zoom,
        offsetX: activeDraft.offsetX,
        offsetY: activeDraft.offsetY,
      };
      return;
    }
    pinchStartRef.current = null;
    if (points.length === 1) {
      const point = points[0];
      cropDragStartRef.current = {
        x: point.x,
        y: point.y,
        startOffsetX: activeDraft.offsetX,
        startOffsetY: activeDraft.offsetY,
      };
    }
  };

  const onCarouselPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    if (cropMode) {
      if (!activeImage || !activeImageSize) {
        return;
      }
      beginCropGestureFromPointers();
      return;
    }
    if (pointersRef.current.size === 1) {
      swipeStartRef.current = { x: event.clientX, y: event.clientY };
    }
  };

  const onCarouselPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) {
      return;
    }
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!cropMode || !activeImage || !activeImageSize) {
      return;
    }

    const points = [...pointersRef.current.values()];
    if (points.length >= 2 && pinchStartRef.current) {
      const [first, second] = points;
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      if (pinchStartRef.current.distance <= 0) {
        return;
      }
      const nextZoom = Math.max(
        1,
        Math.min(3, pinchStartRef.current.zoom * (distance / pinchStartRef.current.distance)),
      );
      const clamped = clampDraftOffsets({
        naturalWidth: activeImageSize.width,
        naturalHeight: activeImageSize.height,
        zoom: nextZoom,
        offsetX: pinchStartRef.current.offsetX,
        offsetY: pinchStartRef.current.offsetY,
      });
      updateActiveDraft({ zoom: nextZoom, offsetX: clamped.x, offsetY: clamped.y });
      return;
    }

    if (!cropDragStartRef.current) {
      return;
    }
    const dx = event.clientX - cropDragStartRef.current.x;
    const dy = event.clientY - cropDragStartRef.current.y;
    const clamped = clampDraftOffsets({
      naturalWidth: activeImageSize.width,
      naturalHeight: activeImageSize.height,
      zoom: activeDraft.zoom,
      offsetX: cropDragStartRef.current.startOffsetX + dx,
      offsetY: cropDragStartRef.current.startOffsetY + dy,
    });
    updateActiveDraft({ offsetX: clamped.x, offsetY: clamped.y });
  };

  const onCarouselPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (cropMode) {
      if (pointersRef.current.size >= 2) {
        beginCropGestureFromPointers();
        return;
      }
      if (pointersRef.current.size === 1) {
        beginCropGestureFromPointers();
        return;
      }
      cropDragStartRef.current = null;
      pinchStartRef.current = null;
      return;
    }

    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start || images.length < 2 || pointersRef.current.size > 0) {
      return;
    }
    const dx = event.clientX - start.x;
    if (dx <= -SWIPE_PAGE_THRESHOLD_PX) {
      goToIndex(activeIndex + 1);
      return;
    }
    if (dx >= SWIPE_PAGE_THRESHOLD_PX) {
      goToIndex(activeIndex - 1);
    }
  };

  const [maxImageAreaHeight, setMaxImageAreaHeight] = useState(0);
  useEffect(() => {
    if (images.length === 0) {
      setMaxImageAreaHeight(0);
    } else {
      setTimeout(() => {
        setMaxImageAreaHeight(100);
      }, 10);
    }
  }, [images])

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
      const imagesToUpload = images;
      const bakedImages = await Promise.all(
        imagesToUpload.map(async (image) => {
          const draft = imageEditDrafts[image.id] ?? createDefaultEditDraft();
          return bakeEditedImage({ sourceDataUrl: image.previewDataUrl, draft });
        }),
      );
      const uploadedImageIds: string[] = [];
      for (const image of bakedImages) {
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
      const dataPayload = {
        ...(otherImageIds.length > 0 ? { other_image_ids: otherImageIds } : {}),
        ...(postKind === "poll"
          ? {
              poll: {
                options: filledPollOptions.map((text) => ({ text })),
                selection_mode: pollSelectionMode,
                allow_vote_changes: pollAllowVoteChanges,
                duration_hours: pollDurationHours,
              },
            }
          : {}),
      };
      const hasDataPayload = Object.keys(dataPayload).length > 0;

      const createResponse = await postWithAuth("/api/post-create", {
        ...(hasCommentText ? { text: comment } : {}),
        ...(primaryImageId ? { image_id: primaryImageId } : {}),
        ...(hasDataPayload ? { data: dataPayload } : {}),
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
      setImageEditDrafts({});
      setActiveIndex(0);
      exitCropTool();
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

  const activeAdjustmentOption =
    ADJUSTMENT_OPTIONS.find((option) => option.key === activeAdjustment) ?? ADJUSTMENT_OPTIONS[0];
  const activeSliderValue = cropMode ? activeDraft.zoom : activeDraft.adjustments[activeAdjustmentOption.key as Exclude<ImageAdjustmentKey, "crop">];

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
        <input
          ref={createInputRef}
          type="file"
          accept="image/*"
          multiple
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

        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={() => createInputRef.current?.click()}
            className="inline-flex min-w-[10rem] flex-col items-center gap-2 rounded-lg border border-accent-1 bg-secondary-background px-6 py-4 text-sm text-accent-3 hover:text-foreground"
          >
            <ImagePlus className="h-10 w-10" />
            <span>Add photos</span>
          </button>
        </div>

        {images.length > 0 ? (
          <div className="mt-4 space-y-3 overflow-hidden transition-all duration-1000" style={{ maxHeight: `${maxImageAreaHeight}vh`}}>
            <div className="relative overflow-visible px-1">
              <button
                type="button"
                onClick={() => goToIndex(activeIndex - 1)}
                disabled={activeIndex <= 0}
                className="absolute left-0 top-1/2 z-30 -translate-y-1/2 rounded-full border border-accent-1 bg-primary-background/90 p-2 text-accent-2 shadow-md backdrop-blur-sm transition hover:text-foreground disabled:opacity-30"
                aria-label="Previous photo"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>

              <div
                className={`relative mx-auto aspect-square w-full max-w-[min(92vw,24rem)] touch-none overflow-visible ${DONT_SWIPE_TABS_CLASSNAME}`}
                style={{ perspective: "1400px", transformStyle: "preserve-3d" }}
                onPointerDown={onCarouselPointerDown}
                onPointerMove={onCarouselPointerMove}
                onPointerUp={onCarouselPointerUp}
                onPointerCancel={onCarouselPointerUp}
              >
                {images.map((image, index) => {
                  const distance = index - activeIndex;
                  const slideStyle = slideTransformForDistance(distance);
                  const isActive = index === activeIndex;
                  const draft = imageEditDrafts[image.id] ?? DEFAULT_EDIT_DRAFT;
                  const imageSize = imageSizes[image.id];
                  const baseScale = imageSize
                    ? Math.max(PREVIEW_SIZE_PX / imageSize.width, PREVIEW_SIZE_PX / imageSize.height)
                    : 1;
                  const slideFilter = buildCanvasFilter(draft.adjustments);
                  const slideVignetteOpacity = (draft.adjustments.vignette / 100) * 0.72;
                  return (
                    <div
                      key={image.id}
                      className="absolute left-1/2 top-1/2 h-[90%] w-[90%] origin-center overflow-hidden rounded-lg border border-accent-1 bg-primary-background shadow-lg shadow-black/45 transition-[transform,opacity] duration-300 ease-out"
                      style={{
                        transform: slideStyle.transform,
                        opacity: slideStyle.opacity,
                        zIndex: slideStyle.zIndex,
                        pointerEvents: isActive ? "auto" : "none",
                        transformStyle: "preserve-3d",
                      }}
                    >
                      {imageSize ? (
                        <div className="relative h-full w-full overflow-hidden rounded-lg">
                          <img
                            src={image.previewDataUrl}
                            alt="New post preview"
                            draggable={false}
                            className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
                            style={{
                              width: `${imageSize.width * baseScale * draft.zoom}px`,
                              height: `${imageSize.height * baseScale * draft.zoom}px`,
                              transform: `translate(-50%, -50%) translate(${draft.offsetX}px, ${draft.offsetY}px)`,
                              filter: slideFilter,
                            }}
                          />
                          {draft.adjustments.vignette > 0 ? (
                            <div
                              className="pointer-events-none absolute inset-0"
                              style={{
                                background:
                                  "radial-gradient(circle at center, rgba(0,0,0,0) 45%, rgba(0,0,0,var(--vignette-opacity)) 100%)",
                                ["--vignette-opacity" as string]: `${slideVignetteOpacity}`,
                              }}
                            />
                          ) : null}
                          {isActive && cropMode ? (
                            <div className="pointer-events-none absolute inset-0 border-2 border-dashed border-accent-3/80" />
                          ) : null}
                        </div>
                      ) : (
                        <img
                          src={image.previewDataUrl}
                          alt="New post preview"
                          draggable={false}
                          className="h-full w-full object-cover"
                        />
                      )}
                      {isActive ? (
                        <button
                          type="button"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={onRemoveActiveImage}
                          className="absolute right-2 top-2 z-20 rounded-full bg-black/60 p-1 text-white opacity-70 hover:bg-black/80"
                          aria-label="Remove image"
                        >
                          <X className="h-6 w-6" />
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => goToIndex(activeIndex + 1)}
                disabled={activeIndex >= images.length - 1}
                className="absolute right-0 top-1/2 z-30 -translate-y-1/2 rounded-full border border-accent-1 bg-primary-background/90 p-2 text-accent-2 shadow-md backdrop-blur-sm transition hover:text-foreground disabled:opacity-30"
                aria-label="Next photo"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </div>

            {images.length > 1 ? (
              <p className="text-center text-xs text-accent-2">
                {activeIndex + 1} / {images.length}
              </p>
            ) : null}

            <div className="rounded-lg border-accent-1 px-2 py-1.5">
              <div className="relative flex items-center justify-center gap-1 px-12">
                  {ADJUSTMENT_OPTIONS.map((option) => {
                    const Icon = option.icon;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => setActiveAdjustment(option.key)}
                        className={`inline-flex shrink-0 items-center rounded-md border p-1.5 transition ${
                          option.key === activeAdjustment
                            ? "border-accent-3 bg-accent-3 text-primary-background"
                            : "border-accent-1 bg-primary-background text-accent-2 hover:text-foreground"
                        }`}
                        aria-label={option.label}
                        title={option.label}
                      >
                        <Icon className="h-4 w-4" />
                      </button>
                    );
                  })}
                <button
                  type="button"
                  onClick={() => {
                    if (!activeImage) {
                      return;
                    }
                    setImageEditDrafts((previous) => ({
                      ...previous,
                      [activeImage.id]: createDefaultEditDraft(),
                    }));
                    setActiveAdjustment("brightness");
                  }}
                  className="absolute right-0 top-1/2 -translate-y-1/2 rounded-md border border-accent-1/50 px-2 py-1 text-[11px] text-accent-2 hover:text-foreground"
                >
                  Reset
                </button>
              </div>

              <div className="mt-1 flex items-center gap-2">
                <input
                  type="range"
                  min={activeAdjustmentOption.min}
                  max={activeAdjustmentOption.max}
                  step={activeAdjustmentOption.step}
                  value={activeSliderValue}
                  onChange={(event) => {
                    const nextValue = Number(event.target.value);
                    if (cropMode) {
                      updateActiveDraft({ zoom: nextValue });
                      return;
                    }
                    updateActiveDraft({
                      adjustments: {
                        ...activeDraft.adjustments,
                        [activeAdjustmentOption.key]: nextValue,
                      },
                    });
                  }}
                  className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-accent-1 accent-accent-3 [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-accent-1 [&::-webkit-slider-thumb]:-mt-1 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent-3 [&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-accent-1 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-accent-3"
                />
                <span className="w-9 shrink-0 text-right text-[11px] text-accent-2">
                  {cropMode
                    ? `${activeDraft.zoom.toFixed(1)}x`
                    : activeSliderValue > 0
                      ? `+${activeSliderValue}`
                      : activeSliderValue}
                </span>
              </div>
              {cropMode ? (
                <p className="mt-0.5 text-center text-[10px] text-accent-2">Pinch to zoom, drag to pan</p>
              ) : null}
            </div>
          </div>
        ) : null}

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
          <div className="mt-[10vh]">
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
