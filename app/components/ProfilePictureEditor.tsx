"use client";

import { ChangeEvent, PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProfileImageRemoveResponse, ProfileImageSetResponse } from "@/app/types/interfaces";

type ProfilePictureEditorProps = {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (profileImageId: string | null, profileImageUrl: string | null) => void;
};

const AUTH_TOKEN_KEY = "auth_token";
const PREVIEW_SIZE_PX = 280;
const OUTPUT_SIZE_PX = 256;

export default function ProfilePictureEditor({
  isOpen,
  onClose,
  onSaved,
}: ProfilePictureEditorProps) {
  const [sourceDataUrl, setSourceDataUrl] = useState<string | null>(null);
  const [imageElement, setImageElement] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const dragStartRef = useRef<{ x: number; y: number; startOffsetX: number; startOffsetY: number } | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
    if (!isOpen) {
      setSourceDataUrl(null);
      setImageElement(null);
      setZoom(1);
      setOffsetX(0);
      setOffsetY(0);
      setIsDragging(false);
      setIsSaving(false);
      setStatusMessage("");
    }
  }, [isOpen]);

  useEffect(() => {
    const clamped = clampOffsets(offsetX, offsetY);
    if (clamped.x !== offsetX) {
      setOffsetX(clamped.x);
    }
    if (clamped.y !== offsetY) {
      setOffsetY(clamped.y);
    }
  }, [clampOffsets, offsetX, offsetY]);

  const onSelectSourceImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    if (!file.type.startsWith("image/")) {
      setStatusMessage("Selected file is not an image.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const nextDataUrl = String(reader.result ?? "");
      const image = new Image();
      image.onload = () => {
        setSourceDataUrl(nextDataUrl);
        setImageElement(image);
        setZoom(1);
        setOffsetX(0);
        setOffsetY(0);
        setStatusMessage("");
      };
      image.onerror = () => setStatusMessage("Failed to load image.");
      image.src = nextDataUrl;
    };
    reader.onerror = () => setStatusMessage("Failed to read image.");
    reader.readAsDataURL(file);
  };

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

  const onSaveProfilePicture = async () => {
    if (!imageElement) {
      return;
    }

    setIsSaving(true);
    setStatusMessage("");
    try {
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
        setStatusMessage("Failed to prepare profile image.");
        return;
      }
      context.drawImage(imageElement, drawX, drawY, drawWidth, drawHeight);

      const outputDataUrl = canvas.toDataURL("image/jpeg", 0.9);
      const base64Data = outputDataUrl.split(",")[1];
      if (!base64Data) {
        setStatusMessage("Failed to encode profile image.");
        return;
      }

      const token = window.localStorage.getItem(AUTH_TOKEN_KEY);
      if (!token) {
        setStatusMessage("Not authenticated.");
        return;
      }

      const response = await fetch("/api/profile-image-set", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          image_base64_data: base64Data,
          image_mime_type: "image/jpeg",
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
        setStatusMessage(body.error?.message ?? "Failed to save profile image.");
        return;
      }

      const payload = (await response.json()) as Partial<ProfileImageSetResponse>;
      if (!payload.profile_image_id || !payload.profile_image_url) {
        setStatusMessage("Profile image saved but URL was missing.");
        return;
      }

      onSaved(payload.profile_image_id, payload.profile_image_url);
      onClose();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to save profile image.");
    } finally {
      setIsSaving(false);
    }
  };

  const onRemoveProfilePicture = async () => {
    setIsSaving(true);
    setStatusMessage("");
    try {
      const token = window.localStorage.getItem(AUTH_TOKEN_KEY);
      if (!token) {
        setStatusMessage("Not authenticated.");
        return;
      }

      const response = await fetch("/api/profile-image-remove", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
        setStatusMessage(body.error?.message ?? "Failed to remove profile image.");
        return;
      }

      const payload = (await response.json()) as ProfileImageRemoveResponse;
      onSaved(payload.profile_image_id, payload.profile_image_url);
      onClose();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to remove profile image.");
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-xl border border-accent-1 bg-secondary-background p-3 shadow-xl shadow-black/35">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Edit Profile Picture</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-accent-1 px-2 py-1 text-xs text-accent-2 hover:text-foreground"
          >
            Close
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={onSelectSourceImage}
          className="hidden"
        />

        {!sourceDataUrl ? (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full h-20 rounded-lg border border-accent-1 bg-primary-background px-3 py-3 text-sm text-accent-2 hover:text-foreground"
            >
              Select image
            </button>
            <button
              type="button"
              onClick={() => {
                void onRemoveProfilePicture();
              }}
              disabled={isSaving}
              className="w-full h-20 rounded-lg border border-accent-1 bg-primary-background px-3 py-2 text-xs text-accent-2 hover:text-foreground disabled:opacity-50"
            >
              {isSaving ? "Removing..." : "Remove Profile Picture"}
            </button>
          </div>
        ) : (
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
                alt="Profile picture crop preview"
                draggable={false}
                className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
                style={{
                  width: `${imageElement ? imageElement.naturalWidth * baseScale * zoom : PREVIEW_SIZE_PX}px`,
                  height: `${imageElement ? imageElement.naturalHeight * baseScale * zoom : PREVIEW_SIZE_PX}px`,
                  transform: `translate(-50%, -50%) translate(${offsetX}px, ${offsetY}px)`,
                }}
              />
            </div>
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
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-lg border border-accent-1 px-3 py-2 text-xs text-accent-2 hover:text-foreground"
              >
                Choose another
              </button>
              <button
                type="button"
                onClick={() => {
                  void onSaveProfilePicture();
                }}
                disabled={isSaving}
                className="rounded-lg bg-accent-3 px-3 py-2 text-xs font-semibold text-primary-background disabled:opacity-50"
              >
                {isSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </>
        )}

        {statusMessage ? <p className="mt-2 text-xs text-accent-2">{statusMessage}</p> : null}
      </div>
    </div>
  );
}
