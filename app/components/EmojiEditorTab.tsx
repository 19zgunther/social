"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadAllCustomEmojis, putEmojiInCache } from "@/app/lib/customEmojiCache";
import { ApiError, EmojiItem, EmojiSaveResponse } from "@/app/types/interfaces";
import { DONT_SWIPE_TABS_CLASSNAME } from "@/app/components/utils/useSwipeBack";
import { Redo, Redo2, Undo, Undo2 } from "lucide-react";

const GRID_SIZE = 64;
const PIXEL_COUNT = GRID_SIZE * GRID_SIZE;
const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const TRANSPARENT_FLAG = 1 << 9;
const EXPLICIT_BLACK_FLAG = 1 << 10;
const RGB_MASK = 0b1_1111_1111;
const TRANSPARENT_PIXEL = TRANSPARENT_FLAG;

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as ApiError;
    return body.error?.message ?? "Request failed.";
  } catch {
    return "Request failed.";
  }
};

const colorValueToHex = (v: number): string => {
  const clamped = Math.max(0, Math.min(7, v));
  const scaled = Math.round((clamped / 7) * 255);
  return scaled.toString(16).padStart(2, "0");
};

const rgb3ToHex = (r: number, g: number, b: number): string =>
  `#${colorValueToHex(r)}${colorValueToHex(g)}${colorValueToHex(b)}`;

const hsvToRgb = (h: number, s: number, v: number): { r: number; g: number; b: number } => {
  const hue = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = v - c;

  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (hue < 60) {
    rp = c; gp = x; bp = 0;
  } else if (hue < 120) {
    rp = x; gp = c; bp = 0;
  } else if (hue < 180) {
    rp = 0; gp = c; bp = x;
  } else if (hue < 240) {
    rp = 0; gp = x; bp = c;
  } else if (hue < 300) {
    rp = x; gp = 0; bp = c;
  } else {
    rp = c; gp = 0; bp = x;
  }

  return { r: rp + m, g: gp + m, b: bp + m };
};

const quantizeRgbFloatTo3Bit = (r: number, g: number, b: number) => ({
  r: Math.max(0, Math.min(7, Math.round(r * 7))),
  g: Math.max(0, Math.min(7, Math.round(g * 7))),
  b: Math.max(0, Math.min(7, Math.round(b * 7))),
});

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const spectrumPositionToRgb3 = (position: number) => {
  const p = Math.max(0, Math.min(1023, position));

  // Segment 1: black -> red
  if (p < 128) {
    const t = p / 127;
    return quantizeRgbFloatTo3Bit(t, 0, 0);
  }

  // Segment 2: red -> orange -> ... -> pink -> red (full hue wheel)
  if (p < 896) {
    const t = (p - 128) / 767;
    const hue = t * 360;
    const rgb = hsvToRgb(hue, 1, 1);
    return quantizeRgbFloatTo3Bit(rgb.r, rgb.g, rgb.b);
  }

  // Segment 3: red -> white
  const t = (p - 896) / 127;
  return quantizeRgbFloatTo3Bit(1, t, t);
};

const decodeDataB64 = (dataB64: string): Uint16Array => {
  const pixels = new Uint16Array(PIXEL_COUNT);
  if (dataB64.length !== PIXEL_COUNT * 2) {
    return pixels;
  }

  for (let i = 0; i < PIXEL_COUNT; i += 1) {
    const first = B64_ALPHABET.indexOf(dataB64[i * 2]);
    const second = B64_ALPHABET.indexOf(dataB64[i * 2 + 1]);
    if (first < 0 || second < 0) {
      continue;
    }
    const r = (first >> 3) & 0b111;
    const g = first & 0b111;
    const b = (second >> 3) & 0b111;
    const rgb = (r << 6) | (g << 3) | b;
    const metadata = second & 0b111;
    const isTransparent = (metadata & 0b001) === 0b001 || (metadata === 0 && rgb === 0);
    const isExplicitOpaqueBlack = metadata === 0b010 && rgb === 0;
    pixels[i] = rgb | (isTransparent ? TRANSPARENT_FLAG : 0) | (isExplicitOpaqueBlack ? EXPLICIT_BLACK_FLAG : 0);
  }

  return pixels;
};

const encodeDataB64 = (pixels: Uint16Array): string => {
  const out = new Array<string>(PIXEL_COUNT * 2);
  for (let i = 0; i < PIXEL_COUNT; i += 1) {
    const packed = pixels[i] ?? 0;
    const rgb = packed & RGB_MASK;
    const metadata =
      (packed & TRANSPARENT_FLAG) === TRANSPARENT_FLAG
        ? 0b001
        : (packed & EXPLICIT_BLACK_FLAG) === EXPLICIT_BLACK_FLAG
          ? 0b010
          : 0;
    const r = (rgb >> 6) & 0b111;
    const g = (rgb >> 3) & 0b111;
    const b = rgb & 0b111;
    out[i * 2] = B64_ALPHABET[(r << 3) | g];
    out[i * 2 + 1] = B64_ALPHABET[(b << 3) | metadata];
  }
  return out.join("");
};

const drawPixelsToCanvas = (canvas: HTMLCanvasElement, pixels: Uint16Array) => {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const imageData = ctx.createImageData(GRID_SIZE, GRID_SIZE);
  for (let i = 0; i < PIXEL_COUNT; i += 1) {
    const packed = pixels[i] ?? 0;
    const rgb = packed & RGB_MASK;
    const r = ((rgb >> 6) & 0b111) * (255 / 7);
    const g = ((rgb >> 3) & 0b111) * (255 / 7);
    const b = (rgb & 0b111) * (255 / 7);
    const alpha = (packed & TRANSPARENT_FLAG) === TRANSPARENT_FLAG ? 0 : 255;
    const offset = i * 4;
    imageData.data[offset] = Math.round(r);
    imageData.data[offset + 1] = Math.round(g);
    imageData.data[offset + 2] = Math.round(b);
    imageData.data[offset + 3] = alpha;
  }
  ctx.putImageData(imageData, 0, 0);
};

const getPixelPosition = (event: PointerEvent | React.PointerEvent, canvas: HTMLCanvasElement) => {
  const rect = canvas.getBoundingClientRect();
  const xRatio = (event.clientX - rect.left) / rect.width;
  const yRatio = (event.clientY - rect.top) / rect.height;
  const x = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(xRatio * GRID_SIZE)));
  const y = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(yRatio * GRID_SIZE)));
  return { x, y };
};

const pixelsEqual = (a: Uint16Array, b: Uint16Array): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
};

type EmojiEditorTabProps = {
  isActive: boolean;
};

export default function EmojiEditorTab({ isActive }: EmojiEditorTabProps) {
  const MAX_HISTORY_STEPS = 100;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const strokeStartPixelsRef = useRef<Uint16Array | null>(null);
  const latestPixelsRef = useRef<Uint16Array>(new Uint16Array(PIXEL_COUNT).fill(TRANSPARENT_PIXEL));
  const [pixels, setPixels] = useState<Uint16Array>(() => new Uint16Array(PIXEL_COUNT).fill(TRANSPARENT_PIXEL));
  const [emojiName, setEmojiName] = useState("Untitled");
  const [selectedEmojiUuid, setSelectedEmojiUuid] = useState<string | null>(null);
  const [thickness, setThickness] = useState(2);
  const [r, setR] = useState(7);
  const [g, setG] = useState(7);
  const [b, setB] = useState(7);
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastPoint, setLastPoint] = useState<{ x: number; y: number } | null>(null);
  const [spectrumPosition, setSpectrumPosition] = useState(512);
  const [emojis, setEmojis] = useState<EmojiItem[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [undoStack, setUndoStack] = useState<Uint16Array[]>([]);
  const [redoStack, setRedoStack] = useState<Uint16Array[]>([]);

  const currentColorPacked = useMemo(() => {
    const rgb = (r << 6) | (g << 3) | b;
    return rgb === 0 ? rgb | EXPLICIT_BLACK_FLAG : rgb;
  }, [r, g, b]);

  const setRgbFromSpectrumPosition = useCallback((position: number) => {
    const { r: nextR, g: nextG, b: nextB } = spectrumPositionToRgb3(position);
    setR(nextR);
    setG(nextG);
    setB(nextB);
  }, []);

  useEffect(() => {
    latestPixelsRef.current = pixels;
    if (!canvasRef.current) {
      return;
    }
    drawPixelsToCanvas(canvasRef.current, pixels);
  }, [pixels]);

  const loadEmojiList = useCallback(async () => {
    setIsLoading(true);
    setStatusMessage("");
    try {
      const emojis = await loadAllCustomEmojis();
      setEmojis(emojis);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to load emojis.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isActive) {
      void loadEmojiList();
    }
  }, [isActive, loadEmojiList]);

  const stampCircle = useCallback((draft: Uint16Array, centerX: number, centerY: number, radius: number, packed: number) => {
    const rSquared = radius * radius;
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (dx * dx + dy * dy > rSquared) {
          continue;
        }
        const x = centerX + dx;
        const y = centerY + dy;
        if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) {
          continue;
        }
        draft[y * GRID_SIZE + x] = packed;
      }
    }
  }, []);

  const drawLine = useCallback(
    (from: { x: number; y: number }, to: { x: number; y: number }) => {
      setPixels((previous) => {
        const draft = previous.slice();
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
        const radius = Math.max(1, Math.round(thickness / 2));
        for (let i = 0; i <= steps; i += 1) {
          const x = Math.round(from.x + (dx * i) / steps);
          const y = Math.round(from.y + (dy * i) / steps);
          stampCircle(draft, x, y, radius, currentColorPacked);
        }
        return draft;
      });
    },
    [currentColorPacked, stampCircle, thickness],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) {
      return;
    }
    strokeStartPixelsRef.current = latestPixelsRef.current.slice();
    const point = getPixelPosition(event, canvasRef.current);
    setIsDrawing(true);
    setLastPoint(point);
    drawLine(point, point);
    canvasRef.current.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !lastPoint || !canvasRef.current) {
      return;
    }
    const point = getPixelPosition(event, canvasRef.current);
    drawLine(lastPoint, point);
    setLastPoint(point);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (canvasRef.current?.hasPointerCapture(event.pointerId)) {
      canvasRef.current.releasePointerCapture(event.pointerId);
    }
    const strokeStartPixels = strokeStartPixelsRef.current;
    const strokeEndPixels = latestPixelsRef.current;
    if (strokeStartPixels && !pixelsEqual(strokeStartPixels, strokeEndPixels)) {
      setUndoStack((previous) => {
        const next = [...previous, strokeStartPixels];
        return next.length > MAX_HISTORY_STEPS ? next.slice(next.length - MAX_HISTORY_STEPS) : next;
      });
      setRedoStack([]);
    }
    strokeStartPixelsRef.current = null;
    setIsDrawing(false);
    setLastPoint(null);
  };

  const onUndo = useCallback(() => {
    setUndoStack((previousUndo) => {
      if (previousUndo.length === 0) {
        return previousUndo;
      }
      const priorPixels = previousUndo[previousUndo.length - 1];
      const currentPixels = latestPixelsRef.current.slice();
      setRedoStack((previousRedo) => [...previousRedo, currentPixels]);
      setPixels(priorPixels.slice());
      return previousUndo.slice(0, -1);
    });
  }, []);

  const onRedo = useCallback(() => {
    setRedoStack((previousRedo) => {
      if (previousRedo.length === 0) {
        return previousRedo;
      }
      const nextPixels = previousRedo[previousRedo.length - 1];
      const currentPixels = latestPixelsRef.current.slice();
      setUndoStack((previousUndo) => {
        const next = [...previousUndo, currentPixels];
        return next.length > MAX_HISTORY_STEPS ? next.slice(next.length - MAX_HISTORY_STEPS) : next;
      });
      setPixels(nextPixels.slice());
      return previousRedo.slice(0, -1);
    });
  }, []);

  const onSelectEmoji = (emoji: EmojiItem) => {
    setSelectedEmojiUuid(emoji.uuid);
    setEmojiName(emoji.name || "Untitled");
    setPixels(decodeDataB64(emoji.data_b64));
    setUndoStack([]);
    setRedoStack([]);
    setStatusMessage(`Loaded "${emoji.name || "Untitled"}".`);
  };

  const onNewEmoji = () => {
    setSelectedEmojiUuid(null);
    setEmojiName("Untitled");
    setPixels(new Uint16Array(PIXEL_COUNT).fill(TRANSPARENT_PIXEL));
    setUndoStack([]);
    setRedoStack([]);
    setStatusMessage("Started a new emoji.");
  };

  const onUploadImage = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setStatusMessage("Please upload an image file.");
      return;
    }

    const previousPixels = latestPixelsRef.current.slice();
    try {
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Could not load image."));
        image.src = objectUrl;
      });

      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = GRID_SIZE;
      tempCanvas.height = GRID_SIZE;
      const tempCtx = tempCanvas.getContext("2d");
      if (!tempCtx) {
        URL.revokeObjectURL(objectUrl);
        setStatusMessage("Could not process image.");
        return;
      }

      tempCtx.clearRect(0, 0, GRID_SIZE, GRID_SIZE);
      tempCtx.imageSmoothingEnabled = true;
      tempCtx.imageSmoothingQuality = "high";
      const scale = Math.min(GRID_SIZE / image.width, GRID_SIZE / image.height);
      const drawWidth = Math.max(1, Math.round(image.width * scale));
      const drawHeight = Math.max(1, Math.round(image.height * scale));
      const drawX = Math.floor((GRID_SIZE - drawWidth) / 2);
      const drawY = Math.floor((GRID_SIZE - drawHeight) / 2);
      tempCtx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
      URL.revokeObjectURL(objectUrl);

      const imageData = tempCtx.getImageData(0, 0, GRID_SIZE, GRID_SIZE).data;
      const importedPixels = new Uint16Array(PIXEL_COUNT).fill(TRANSPARENT_PIXEL);
      const red = new Float32Array(PIXEL_COUNT);
      const green = new Float32Array(PIXEL_COUNT);
      const blue = new Float32Array(PIXEL_COUNT);
      const alpha = new Uint8Array(PIXEL_COUNT);
      for (let i = 0; i < PIXEL_COUNT; i += 1) {
        const offset = i * 4;
        red[i] = (imageData[offset] ?? 0) / 255;
        green[i] = (imageData[offset + 1] ?? 0) / 255;
        blue[i] = (imageData[offset + 2] ?? 0) / 255;
        alpha[i] = imageData[offset + 3] ?? 0;
      }

      for (let y = 0; y < GRID_SIZE; y += 1) {
        for (let x = 0; x < GRID_SIZE; x += 1) {
          const i = y * GRID_SIZE + x;
          if ((alpha[i] ?? 0) < 96) {
            importedPixels[i] = TRANSPARENT_PIXEL;
            continue;
          }

          const currentR = clamp01(red[i] ?? 0);
          const currentG = clamp01(green[i] ?? 0);
          const currentB = clamp01(blue[i] ?? 0);
          const r3 = Math.round(currentR * 7);
          const g3 = Math.round(currentG * 7);
          const b3 = Math.round(currentB * 7);
          const quantizedR = r3 / 7;
          const quantizedG = g3 / 7;
          const quantizedB = b3 / 7;

          let packed = (r3 << 6) | (g3 << 3) | b3;
          if (packed === 0) {
            packed |= EXPLICIT_BLACK_FLAG;
          }
          importedPixels[i] = packed;

          const errorR = currentR - quantizedR;
          const errorG = currentG - quantizedG;
          const errorB = currentB - quantizedB;
          const spreadError = (targetX: number, targetY: number, weight: number) => {
            if (targetX < 0 || targetX >= GRID_SIZE || targetY < 0 || targetY >= GRID_SIZE) {
              return;
            }
            const targetIndex = targetY * GRID_SIZE + targetX;
            red[targetIndex] = clamp01((red[targetIndex] ?? 0) + errorR * weight);
            green[targetIndex] = clamp01((green[targetIndex] ?? 0) + errorG * weight);
            blue[targetIndex] = clamp01((blue[targetIndex] ?? 0) + errorB * weight);
          };

          spreadError(x + 1, y, 7 / 16);
          spreadError(x - 1, y + 1, 3 / 16);
          spreadError(x, y + 1, 5 / 16);
          spreadError(x + 1, y + 1, 1 / 16);
        }
      }

      setUndoStack((previous) => {
        const next = [...previous, previousPixels];
        return next.length > MAX_HISTORY_STEPS ? next.slice(next.length - MAX_HISTORY_STEPS) : next;
      });
      setRedoStack([]);
      setPixels(importedPixels);
      if (!selectedEmojiUuid) {
        const inferredName = file.name.replace(/\.[^/.]+$/, "").trim();
        if (inferredName) {
          setEmojiName(inferredName.slice(0, 40));
        }
      }
      setStatusMessage("Imported image into emoji canvas.");
    } catch {
      setStatusMessage("Failed to import image.");
    }
  };

  const onSaveEmoji = async () => {
    setIsSaving(true);
    setStatusMessage("");
    try {
      const response = await fetch("/api/emoji-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emoji_uuid: selectedEmojiUuid ?? undefined,
          name: emojiName.trim() || "Untitled",
          data_b64: encodeDataB64(pixels),
        }),
      });
      if (!response.ok) {
        setStatusMessage(await readErrorMessage(response));
        return;
      }

      const payload = (await response.json()) as EmojiSaveResponse;
      const saved = payload.emoji;
      await putEmojiInCache(saved);
      setSelectedEmojiUuid(saved.uuid);
      setEmojis((previous) => {
        const remaining = previous.filter((row) => row.uuid !== saved.uuid);
        return [saved, ...remaining];
      });
      setStatusMessage("Emoji saved.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to save emoji.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className={`border-b border-accent-1 px-3 py-3 ${DONT_SWIPE_TABS_CLASSNAME}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">Emoji Editor</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onNewEmoji}
            className="rounded-lg border border-accent-1 bg-secondary-background px-3 py-1.5 text-xs text-accent-2 hover:text-foreground"
          >
            + New Emoji
          </button>
          <button
            type="button"
            onClick={() => uploadInputRef.current?.click()}
            className="rounded-lg border border-accent-1 bg-secondary-background px-3 py-1.5 text-xs text-accent-2 hover:text-foreground"
          >
            + Upload Image
          </button>
          <input
            ref={uploadInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void onUploadImage(file);
              }
              event.currentTarget.value = "";
            }}
          />
        </div>
      </div>

      <div className="mb-3">
        <label className="mb-1 block text-xs text-accent-2" htmlFor="emoji-name-input">Name</label>
        <input
          id="emoji-name-input"
          type="text"
          value={emojiName}
          onChange={(event) => setEmojiName(event.target.value)}
          maxLength={40}
          className="w-full rounded-lg border border-accent-1 bg-primary-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent-2"
          placeholder="Emoji name"
        />
      </div>

      <div className="mb-3 flex justify-center gap-2">
        <button
          type="button"
          onClick={onUndo}
          disabled={undoStack.length === 0}
          className="rounded-lg border border-accent-1 bg-secondary-background px-2 py-1 text-xs text-accent-2 hover:text-foreground disabled:opacity-40"
        >
          <Undo2 />
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={redoStack.length === 0}
          className="rounded-lg border border-accent-1 bg-secondary-background px-2 py-1 text-xs text-accent-2 hover:text-foreground disabled:opacity-40"
        >
          <Redo2 />
        </button>
        <div className="px-2 py-0 ml-8">
          <p className="mb-1 text-xs text-accent-2">Brush thickness ({thickness}px)</p>
          <input
            type="range"
            min={1}
            max={8}
            step={1}
            value={thickness}
            onChange={(event) => setThickness(Number(event.target.value))}
            className="w-full"
          />
        </div>
      </div>

      <div className="mb-3 rounded-lg border border-accent-1 p-2" style={{ borderColor: rgb3ToHex(r, g, b), borderWidth: "3px" }}>
        <input
          id="emoji-color-slider"
          type="range"
          min={0}
          max={1023}
          step={1}
          value={spectrumPosition}
          onChange={(event) => {
            const position = Number(event.target.value);
            setSpectrumPosition(position);
            setRgbFromSpectrumPosition(position);
          }}
          className="w-full"
          style={{
            background:
              "linear-gradient(90deg, #000000 0%, #ff0000 10%, #ff7a00 20%, #ffff00 30%, #00ff00 40%, #66ffff 50%, #0066ff 60%, #6b00ff 70%, #a300ff 80%, #ff4da6 90%, #ff0000 96%, #ffffff 100%)",
          }}
        />
        <div className="mt-2 grid grid-cols-12 gap-1">
          {[
            "#000000", "#ff0000", "#ff7a00", "#ffff00", "#00ff00", "#66ffff",
            "#0066ff", "#6b00ff", "#a300ff", "#ff4da6", "#ff0000", "#ffffff",
          ].map((hex, index) => {
            const rr = Math.round((parseInt(hex.slice(1, 3), 16) / 255) * 7);
            const gg = Math.round((parseInt(hex.slice(3, 5), 16) / 255) * 7);
            const bb = Math.round((parseInt(hex.slice(5, 7), 16) / 255) * 7);
            const selected = rr === r && gg === g && bb === b;
            return (
              <button
                key={`${hex}-${index}`}
                type="button"
                onClick={() => {
                  setR(rr);
                  setG(gg);
                  setB(bb);
                }}
                className={`aspect-square rounded border border-accent-1 ${selected ? "ring-2 ring-accent-3" : ""}`}
                style={{ backgroundColor: hex }}
                title={hex}
              />
            );
          })}
        </div>
      </div>

      <div className="mb-3 flex justify-center rounded-lg border border-accent-1 p-2">
        <canvas
          ref={canvasRef}
          width={GRID_SIZE}
          height={GRID_SIZE}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="mx-1 aspect-square w-[90vw] touch-none rounded border border-accent-1 [image-rendering:pixelated]"
        />
      </div>

      <button
        type="button"
        onClick={() => { void onSaveEmoji(); }}
        disabled={isSaving}
        className="mb-4 w-full rounded-lg bg-accent-3 px-3 py-2 text-sm font-semibold text-primary-background disabled:opacity-50"
      >
        {isSaving ? "Saving..." : selectedEmojiUuid ? "Save Changes" : "Create Emoji"}
      </button>

      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold text-accent-2">Your emojis</p>
        {isLoading ? <p className="text-xs text-accent-2">Loading...</p> : null}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {emojis.map((emoji) => (
          <button
            key={emoji.uuid}
            type="button"
            onClick={() => onSelectEmoji(emoji)}
            className={`rounded-lg p-2 text-left ${selectedEmojiUuid === emoji.uuid ? "border border-accent-3" : "border-accent-1"}`}
          >
            <div className="mb-1 h-[20vw] w-[20vw] overflow-hidden rounded">
              <canvas
                width={GRID_SIZE}
                height={GRID_SIZE}
                ref={(el) => {
                  if (!el) {
                    return;
                  }
                  const ctx = el.getContext("2d");
                  if (!ctx) {
                    return;
                  }
                  const smallPixels = decodeDataB64(emoji.data_b64);
                  const imageData = ctx.createImageData(GRID_SIZE, GRID_SIZE);
                  for (let i = 0; i < PIXEL_COUNT; i += 1) {
                    const packed = smallPixels[i] ?? 0;
                    const rgb = packed & RGB_MASK;
                    imageData.data[i * 4] = Math.round(((rgb >> 6) & 0b111) * (255 / 7));
                    imageData.data[i * 4 + 1] = Math.round(((rgb >> 3) & 0b111) * (255 / 7));
                    imageData.data[i * 4 + 2] = Math.round((rgb & 0b111) * (255 / 7));
                    imageData.data[i * 4 + 3] = (packed & TRANSPARENT_FLAG) === TRANSPARENT_FLAG ? 0 : 255;
                  }
                  ctx.putImageData(imageData, 0, 0);
                }}
                className="h-full w-full [image-rendering:pixelated]"
              />
            </div>
            <p className="truncate text-[10px] text-accent-2">{emoji.name || "Untitled"}</p>
          </button>
        ))}
      </div>

      {statusMessage ? <p className="mt-3 text-xs text-accent-2">{statusMessage}</p> : null}
    </section>
  );
}
