export type PreparedImageUpload = {
  base64Data: string;
  mimeType: string;
  previewDataUrl: string;
};

const BROWSER_SAFE_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

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

const normalizeImageDataUrl = async (
  dataUrl: string,
): Promise<{ normalizedDataUrl: string; normalizedMimeType: string }> => {
  const image = await loadImageElement(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to process selected image.");
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const normalizedMimeType = "image/jpeg";
  return {
    normalizedDataUrl: canvas.toDataURL(normalizedMimeType, 0.92),
    normalizedMimeType,
  };
};

export const prepareImageForUpload = async (file: File): Promise<PreparedImageUpload> => {
  if (!file.type.startsWith("image/")) {
    throw new Error("Selected file is not an image.");
  }

  const originalDataUrl = await fileToDataUrl(file);
  const isBrowserSafeType = BROWSER_SAFE_IMAGE_MIME_TYPES.has(file.type);
  const { normalizedDataUrl, normalizedMimeType } = isBrowserSafeType
    ? { normalizedDataUrl: originalDataUrl, normalizedMimeType: file.type }
    : await normalizeImageDataUrl(originalDataUrl);

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
