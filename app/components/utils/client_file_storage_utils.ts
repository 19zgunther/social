import type {
  ApiError,
  ImageUploadResponse,
  ImageUploadSignResponse,
} from "@/app/types/interfaces";
import {
  isAllowedVideoMimeType,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_DURATION_SECONDS,
} from "@/app/lib/postMedia";

const readApiErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  try {
    const body = (await response.json()) as ApiError;
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
};

export type PreparedImageUpload = {
  base64Data: string;
  mimeType: string;
  previewDataUrl: string;
};

export type PreparedVideoUpload = {
  file: File;
  mimeType: string;
  previewObjectUrl: string;
  poster: PreparedImageUpload;
};

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });

const loadImageElement = (dataUrl: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to decode selected image."));
    image.src = dataUrl;
  });

const MAX_IMAGE_DIMENSION = 1440;

const normalizeImageDataUrl = async (
  dataUrl: string,
): Promise<{ normalizedDataUrl: string; normalizedMimeType: string }> => {
  const image = await loadImageElement(dataUrl);
  const canvas = document.createElement("canvas");

  const originalWidth = image.naturalWidth || image.width;
  const originalHeight = image.naturalHeight || image.height;
  const largestSide = Math.max(originalWidth, originalHeight);
  const scale =
    largestSide > MAX_IMAGE_DIMENSION ? MAX_IMAGE_DIMENSION / largestSide : 1;

  const targetWidth = Math.max(1, Math.round(originalWidth * scale));
  const targetHeight = Math.max(1, Math.round(originalHeight * scale));

  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to process selected image.");
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const normalizedMimeType = "image/jpeg";
  return {
    normalizedDataUrl: canvas.toDataURL(normalizedMimeType, 0.85),
    normalizedMimeType,
  };
};

export const prepareImageForUpload = async (file: File): Promise<PreparedImageUpload> => {
  if (!file.type.startsWith("image/")) {
    throw new Error("Selected file is not an image.");
  }

  const originalDataUrl = await fileToDataUrl(file);
  const { normalizedDataUrl, normalizedMimeType } = await normalizeImageDataUrl(originalDataUrl);

  const base64Data = normalizedDataUrl.split(",")[1];
  if (!base64Data) {
    throw new Error("Invalid image data.");
  }

  return {
    base64Data,
    mimeType: normalizedMimeType || "image/jpeg",
    previewDataUrl: normalizedDataUrl,
  };
};

/** Matches Supabase storage-js `uploadToSignedUrl` (FormData + PUT). */
export const uploadBlobToSupabaseSignedUploadUrl = async (
  signedUploadUrl: string,
  blob: Blob,
  options?: { cacheControl?: string; signal?: AbortSignal },
): Promise<void> => {
  const formData = new FormData();
  formData.append("cacheControl", options?.cacheControl ?? "3600");
  formData.append("", blob);

  const response = await fetch(signedUploadUrl, {
    method: "PUT",
    body: formData,
    headers: {
      "x-upsert": "true",
    },
    signal: options?.signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Storage upload failed (${response.status}): ${text}`);
  }
};

const uploadBlobWithSignedFlow = async (
  blob: Blob,
  mimeType: string,
  postWithAuth: (path: string, body: unknown) => Promise<Response>,
  failureLabels: { start: string; finalize: string },
): Promise<ImageUploadResponse> => {
  const signResponse = await postWithAuth("/api/image-upload", {
    phase: "sign",
    image_mime_type: mimeType,
  });
  if (!signResponse.ok) {
    throw new Error(await readApiErrorMessage(signResponse, failureLabels.start));
  }

  const signPayload = (await signResponse.json()) as ImageUploadSignResponse;
  if (!signPayload.signed_upload_url || !signPayload.image_id) {
    throw new Error("Invalid sign response from server.");
  }

  await uploadBlobToSupabaseSignedUploadUrl(signPayload.signed_upload_url, blob);

  const completeResponse = await postWithAuth("/api/image-upload", {
    phase: "complete",
    image_id: signPayload.image_id,
  });
  if (!completeResponse.ok) {
    throw new Error(await readApiErrorMessage(completeResponse, failureLabels.finalize));
  }

  return (await completeResponse.json()) as ImageUploadResponse;
};

/**
 * Two-step signed URL flow: avoids sending image bytes through the app server.
 */
export const uploadPreparedImageToMainBucket = async (
  prepared: PreparedImageUpload,
  postWithAuth: (path: string, body: unknown) => Promise<Response>,
): Promise<ImageUploadResponse> => {
  const blob = await fetch(prepared.previewDataUrl).then((response) => response.blob());
  return uploadBlobWithSignedFlow(blob, prepared.mimeType, postWithAuth, {
    start: "Failed to start image upload.",
    finalize: "Failed to finalize image upload.",
  });
};

export const prepareVideoForUpload = async (file: File): Promise<PreparedVideoUpload> => {
  if (!isAllowedVideoMimeType(file.type)) {
    throw new Error("Selected video must be MP4, WebM, or MOV.");
  }
  if (file.size > MAX_VIDEO_BYTES) {
    throw new Error("Video must be 50 MB or smaller.");
  }

  const previewObjectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("Failed to load selected video."));
      video.src = previewObjectUrl;
    });

    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      throw new Error("Could not read video duration.");
    }
    if (video.duration > MAX_VIDEO_DURATION_SECONDS + 0.25) {
      throw new Error("Video must be 60 seconds or shorter.");
    }

    const seekTime = video.duration > 0.1 ? Math.min(0.1, video.duration / 2) : 0;
    if (seekTime > 0) {
      await new Promise<void>((resolve, reject) => {
        video.onseeked = () => resolve();
        video.onerror = () => reject(new Error("Failed to capture video poster."));
        video.currentTime = seekTime;
      });
    }

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (width <= 0 || height <= 0) {
      throw new Error("Could not capture video poster.");
    }
    const scale = Math.max(width, height) > MAX_IMAGE_DIMENSION
      ? MAX_IMAGE_DIMENSION / Math.max(width, height)
      : 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Unable to process video poster.");
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const previewDataUrl = canvas.toDataURL("image/jpeg", 0.85);
    const base64Data = previewDataUrl.split(",")[1];
    if (!base64Data) {
      throw new Error("Invalid video poster data.");
    }

    return {
      file,
      mimeType: file.type,
      previewObjectUrl,
      poster: { base64Data, mimeType: "image/jpeg", previewDataUrl },
    };
  } catch (error) {
    URL.revokeObjectURL(previewObjectUrl);
    throw error;
  } finally {
    video.removeAttribute("src");
    video.load();
  }
};

export const uploadPreparedVideoToMainBucket = async (
  prepared: PreparedVideoUpload,
  postWithAuth: (path: string, body: unknown) => Promise<Response>,
): Promise<{ video_id: string; poster_id: string }> => {
  const posterUpload = await uploadPreparedImageToMainBucket(prepared.poster, postWithAuth);
  if (!posterUpload.image_id) {
    throw new Error("Video poster upload failed.");
  }

  const videoUpload = await uploadBlobWithSignedFlow(
    prepared.file,
    prepared.mimeType,
    postWithAuth,
    {
      start: "Failed to start video upload.",
      finalize: "Failed to finalize video upload.",
    },
  );
  if (!videoUpload.image_id) {
    throw new Error("Video upload failed.");
  }

  return {
    video_id: videoUpload.image_id,
    poster_id: posterUpload.image_id,
  };
};
