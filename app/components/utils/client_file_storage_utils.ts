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
