import type {
  ApiError,
  ImageUploadResponse,
  ImageUploadSignResponse,
} from "@/app/types/interfaces";

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

/**
 * Two-step signed URL flow: avoids sending image bytes through the app server.
 */
export const uploadPreparedImageToMainBucket = async (
  prepared: PreparedImageUpload,
  postWithAuth: (path: string, body: unknown) => Promise<Response>,
): Promise<ImageUploadResponse> => {
  const signResponse = await postWithAuth("/api/image-upload", {
    phase: "sign",
    image_mime_type: prepared.mimeType,
  });
  if (!signResponse.ok) {
    throw new Error(await readApiErrorMessage(signResponse, "Failed to start image upload."));
  }

  const signPayload = (await signResponse.json()) as ImageUploadSignResponse;
  if (!signPayload.signed_upload_url || !signPayload.image_id) {
    throw new Error("Invalid sign response from server.");
  }

  const blob = await fetch(prepared.previewDataUrl).then((r) => r.blob());
  await uploadBlobToSupabaseSignedUploadUrl(signPayload.signed_upload_url, blob);

  const completeResponse = await postWithAuth("/api/image-upload", {
    phase: "complete",
    image_id: signPayload.image_id,
  });
  if (!completeResponse.ok) {
    throw new Error(await readApiErrorMessage(completeResponse, "Failed to finalize image upload."));
  }

  return (await completeResponse.json()) as ImageUploadResponse;
};
