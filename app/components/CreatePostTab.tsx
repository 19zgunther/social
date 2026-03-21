"use client";

import { ChangeEvent, PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Aperture, ArrowLeft, Contrast, Droplets, Palette, PenBoxIcon, Plus, Sun, Thermometer, X } from "lucide-react";
import { prepareImageForUpload } from "@/app/components/utils/client_file_storage_utils";
import { ApiError, ImageUploadResponse } from "@/app/types/interfaces";
import { DONT_SWIPE_TABS_CLASSNAME } from "./utils/useSwipeBack";

type CreatePostTabProps = {
  isActive: boolean;
  onCancel: () => void;
  onPosted: () => void;
};

type PendingUploadImage = {
  id: string;
  previewDataUrl: string;
  base64Data: string;
  mimeType: string;
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

export default function CreatePostTab({ isActive, onCancel, onPosted }: CreatePostTabProps) {
  const createInputRef = useRef<HTMLInputElement | null>(null);
  const [comment, setComment] = useState("");
  const [images, setImages] = useState<PendingUploadImage[]>([]);
  const [editingImageId, setEditingImageId] = useState<string | null>(null);
  const [isPosting, setIsPosting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const editingImage = editingImageId ? images.find((image) => image.id === editingImageId) ?? null : null;

  useEffect(() => {
    if (!isActive) {
      return;
    }
    window.setTimeout(() => {
      createInputRef.current?.click();
    }, 0);
  }, [isActive]);

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
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to prepare image.");
    }
  };

  const onPost = async () => {
    if (images.length === 0 || isPosting) {
      return;
    }

    setIsPosting(true);
    setStatusMessage("");
    try {
      const uploadedImageIds: string[] = [];
      for (const image of images) {
        const response = await postWithAuth("/api/image-upload", {
          image_base64_data: image.base64Data,
          image_mime_type: image.mimeType,
        });
        if (!response.ok) {
          setStatusMessage(await readErrorMessage(response));
          return;
        }

        const payload = (await response.json()) as ImageUploadResponse;
        if (!payload.image_id) {
          setStatusMessage("Image upload failed.");
          return;
        }
        uploadedImageIds.push(payload.image_id);
      }

      const [primaryImageId, ...otherImageIds] = uploadedImageIds;
      const createResponse = await postWithAuth("/api/post-create", {
        text: comment.trim(),
        image_id: primaryImageId,
        ...(otherImageIds.length > 0 ? { data: { other_image_ids: otherImageIds } } : {}),
      });
      if (!createResponse.ok) {
        setStatusMessage(await readErrorMessage(createResponse));
        return;
      }

      setComment("");
      setImages([]);
      onPosted();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to create post.");
    } finally {
      setIsPosting(false);
    }
  };

  return (
    <div className={`flex h-full min-h-0 w-full flex-col bg-primary-background ${DONT_SWIPE_TABS_CLASSNAME}`}>
      <div className="flex items-center justify-between border-b border-accent-1 px-3 py-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full flex gap-2 border border-accent-1 bg-secondary-background px-3 py-1 text-xs text-accent-2 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Cancel
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-3">
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
          multiple
          onChange={onSelectPostImages}
          className="hidden"
        />

        <button
          type="button"
          onClick={() => createInputRef.current?.click()}
          className="mb-3 inline-flex items-center gap-2 rounded-lg border border-accent-1 bg-secondary-background px-3 py-2 text-xs text-accent-2 hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
          Add photos
        </button>

        <div className="-mx-1 w-[calc(100%+0.5rem)] overflow-x-auto pb-1">
          <div className="flex w-max flex-nowrap gap-2 px-1">
            {images.map((image) => (
              <div
                key={image.id}
                className="relative aspect-square h-32 flex-none overflow-hidden rounded-lg border border-accent-1 sm:h-36"
              >
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
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Write a comment..."
            className="min-h-28 w-full rounded-lg border border-accent-1 bg-secondary-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent-2"
          />
        </div>

        {statusMessage ? <p className="mt-2 text-xs text-accent-2">{statusMessage}</p> : null}
      </div>

      <div className="flex justify-end border-t border-accent-1 px-3 py-3">
        <button
          type="button"
          onClick={() => {
            void onPost();
          }}
          disabled={images.length === 0 || isPosting}
          className="rounded-xl bg-accent-3 px-6 py-3 text-base font-semibold text-primary-background transition hover:brightness-110 disabled:opacity-50"
        >
          {isPosting ? "Posting..." : "Post ->"}
        </button>
      </div>
    </div>
  );
}
