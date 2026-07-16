"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loadAllCustomEmojis, putEmojiInCache } from "@/app/lib/customEmojiCache";
import { ApiError, EmojiItem, EmojiSaveResponse } from "@/app/types/interfaces";
import { DONT_SWIPE_TABS_CLASSNAME } from "@/app/components/utils/useSwipeBack";
import { PixelGradientSlider } from "@/app/components/utils/PixelGradientSlider";
import { TriangleThicknessSlider } from "@/app/components/utils/TriangleThicknessSlider";
import { Brush, Eraser, Hand, ImagePlus, Plus, Redo2, Undo2, ZoomIn, ZoomOut } from "lucide-react";

const GRID_SIZE = 64;
const PIXEL_COUNT = GRID_SIZE * GRID_SIZE;
const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const TRANSPARENT_FLAG = 1 << 9;
const EXPLICIT_BLACK_FLAG = 1 << 10;
const RGB_MASK = 0b1_1111_1111;
const TRANSPARENT_PIXEL = TRANSPARENT_FLAG;

/**
 * Map brush thickness (slider) to stamp radius in grid pixels.
 * Radius 0 draws a single cell; larger values expand the circular stamp (odd-ish diameters).
 */
const radiusFromThickness = (thickness: number): number => {
  const t = Number(thickness);
  if (!Number.isFinite(t)) {
    return 0;
  }
  return Math.max(0, Math.round((t - 1) / 2));
};

/** Discrete zoom steps (emoji editor canvas). */
const EDITOR_ZOOM_LEVELS = [1, 1.3, 1.6, 2, 3, 4] as const;

type EditorTool = "draw" | "move" | "erase";
type EditorMode = "none" | "creating" | "editing";
type ViewportPan = { x: number; y: number };

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

/** Full-chroma RGB in 0–1 space (same path as the hue slider, before shade toward black). */
const spectrumPositionToRgbFloat = (position: number): { r: number; g: number; b: number } => {
  const p = Math.max(0, Math.min(1023, position));

  // Segment 1: black -> red
  if (p < 128) {
    const t = p / 127;
    return { r: t, g: 0, b: 0 };
  }

  // Segment 2: full hue wheel at S=1, V=1
  if (p < 896) {
    const t = (p - 128) / 767;
    const hue = t * 360;
    return hsvToRgb(hue, 1, 1);
  }

  // Segment 3: red -> white
  const t = (p - 896) / 127;
  return { r: 1, g: t, b: t };
};

const spectrumPositionToCssColor = (position: number): string => {
  const { r, g, b } = spectrumPositionToRgbFloat(position);
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
};

const BRIGHTNESS_MAX = 1023;

/** Fade selected hue toward black; then quantize to 3-bit channels (enables browns and other dark tones). */
const rgb3FromSpectrumAndBrightness = (position: number, brightnessValue: number) => {
  const base = spectrumPositionToRgbFloat(position);
  const factor = clamp01(brightnessValue / BRIGHTNESS_MAX);
  return quantizeRgbFloatTo3Bit(base.r * factor, base.g * factor, base.b * factor);
};

/** Pick spectrum + brightness so preset swatches stay consistent with the two sliders. */
const bestSpectrumAndBrightnessForRgb3 = (rr: number, gg: number, bb: number): { position: number; brightness: number } => {
  const mx = Math.max(rr, gg, bb);
  if (mx === 0) {
    return { position: 0, brightness: 0 };
  }
  const brightness = Math.round((mx / 7) * BRIGHTNESS_MAX);
  let bestP = 0;
  let bestScore = Infinity;
  for (let p = 0; p <= BRIGHTNESS_MAX; p += 1) {
    const { r: pr, g: pg, b: pb } = rgb3FromSpectrumAndBrightness(p, brightness);
    const score = (pr - rr) ** 2 + (pg - gg) ** 2 + (pb - bb) ** 2;
    if (score < bestScore) {
      bestScore = score;
      bestP = p;
    }
  }
  return { position: bestP, brightness };
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

/**
 * Map pointer to grid coords. Uses `getBoundingClientRect()` only — that rect is already
 * after CSS `translate` + `scale`, so we must not subtract pan or divide by zoom again.
 */
const getPixelPosition = (event: PointerEvent | React.PointerEvent, canvas: HTMLCanvasElement) => {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return { x: 0, y: 0 };
  }
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
  /** Called after a successful save so hosts can refresh cached emoji lists. */
  onSaved?: () => void;
};

export default function EmojiEditorTab({ isActive, onSaved }: EmojiEditorTabProps) {
  const MAX_HISTORY_STEPS = 100;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasViewportRef = useRef<HTMLDivElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const strokeStartPixelsRef = useRef<Uint16Array | null>(null);
  const panStartClientRef = useRef<{ x: number; y: number } | null>(null);
  const latestPixelsRef = useRef<Uint16Array>(new Uint16Array(PIXEL_COUNT).fill(TRANSPARENT_PIXEL));
  const [pixels, setPixels] = useState<Uint16Array>(() => new Uint16Array(PIXEL_COUNT).fill(TRANSPARENT_PIXEL));
  const [editorMode, setEditorMode] = useState<EditorMode>("none");
  const [emojiName, setEmojiName] = useState("");
  const [selectedEmojiUuid, setSelectedEmojiUuid] = useState<string | null>(null);
  const [thickness, setThickness] = useState(2);
  const [spectrumPosition, setSpectrumPosition] = useState(1023);
  /** 0 = black, BRIGHTNESS_MAX = full strength of the current hue slider position. */
  const [brightness, setBrightness] = useState(BRIGHTNESS_MAX);
  const { r, g, b } = useMemo(
    () => rgb3FromSpectrumAndBrightness(spectrumPosition, brightness),
    [spectrumPosition, brightness],
  );
  const [isDrawing, setIsDrawing] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [lastPoint, setLastPoint] = useState<{ x: number; y: number } | null>(null);
  const [activeTool, setActiveTool] = useState<EditorTool>("draw");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<ViewportPan>({ x: 0, y: 0 });
  const clampPan = useCallback((candidate: ViewportPan, currentZoom: number): ViewportPan => {
    const viewport = canvasViewportRef.current;
    if (!viewport || currentZoom <= 1) {
      return { x: 0, y: 0 };
    }
    const { width, height } = viewport.getBoundingClientRect();
    const minX = width - width * currentZoom;
    const minY = height - height * currentZoom;
    return {
      x: Math.min(0, Math.max(minX, candidate.x)),
      y: Math.min(0, Math.max(minY, candidate.y)),
    };
  }, []);

  const [emojis, setEmojis] = useState<EmojiItem[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [undoStack, setUndoStack] = useState<Uint16Array[]>([]);
  const [redoStack, setRedoStack] = useState<Uint16Array[]>([]);
  const [portalMounted, setPortalMounted] = useState(false);

  useEffect(() => {
    // DOM is unavailable during SSR; defer portal until after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount gate for createPortal
    setPortalMounted(true);
  }, []);

  useEffect(() => {
    if (editorMode === "none") {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [editorMode]);

  const currentColorPacked = useMemo(() => {
    const rgb = (r << 6) | (g << 3) | b;
    return rgb === 0 ? rgb | EXPLICIT_BLACK_FLAG : rgb;
  }, [r, g, b]);

  const shadeColorAt = useCallback(
    (brightnessValue: number): string => {
      const base = spectrumPositionToRgbFloat(spectrumPosition);
      const factor = clamp01(brightnessValue / BRIGHTNESS_MAX);
      return `rgb(${Math.round(base.r * factor * 255)}, ${Math.round(base.g * factor * 255)}, ${Math.round(base.b * factor * 255)})`;
    },
    [spectrumPosition],
  );

  useEffect(() => {
    latestPixelsRef.current = pixels;
    if (!canvasRef.current) {
      return;
    }
    drawPixelsToCanvas(canvasRef.current, pixels);
  }, [pixels]);

  useEffect(() => {
    if (editorMode === "none") {
      return;
    }
    // Portal canvas mounts with the mode change; draw after layout so the bitmap is visible.
    const frame = window.requestAnimationFrame(() => {
      if (canvasRef.current) {
        drawPixelsToCanvas(canvasRef.current, latestPixelsRef.current);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editorMode]);

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
    (from: { x: number; y: number }, to: { x: number; y: number }, packed: number) => {
      setPixels((previous) => {
        const draft = previous.slice();
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
        const radius = radiusFromThickness(thickness);
        for (let i = 0; i <= steps; i += 1) {
          const x = Math.round(from.x + (dx * i) / steps);
          const y = Math.round(from.y + (dy * i) / steps);
          stampCircle(draft, x, y, radius, packed);
        }
        return draft;
      });
    },
    [stampCircle, thickness],
  );

  const resetViewport = useCallback(() => {
    setZoom(EDITOR_ZOOM_LEVELS[0]);
    setPan({ x: 0, y: 0 });
  }, []);

  const applyZoom = useCallback(
    (nextZoom: number) => {
      // At 1× there is nothing to pan (canvas fills the viewport); clear offset explicitly.
      if (nextZoom <= 1) {
        setZoom(EDITOR_ZOOM_LEVELS[0]);
        setPan({ x: 0, y: 0 });
        return;
      }

      const viewport = canvasViewportRef.current;
      if (!viewport) {
        setZoom(nextZoom);
        setPan({ x: 0, y: 0 });
        return;
      }
      const { width, height } = viewport.getBoundingClientRect();
      const cx = width / 2;
      const cy = height / 2;
      const worldX = (cx - pan.x) / zoom;
      const worldY = (cy - pan.y) / zoom;
      const nextPan = clampPan(
        {
          x: cx - worldX * nextZoom,
          y: cy - worldY * nextZoom,
        },
        nextZoom,
      );
      setZoom(nextZoom);
      setPan(nextPan);
    },
    [clampPan, pan.x, pan.y, zoom],
  );

  const zoomIn = useCallback(() => {
    const idx = EDITOR_ZOOM_LEVELS.findIndex((level) => Math.abs(level - zoom) < 1e-6);
    const currentIdx = idx >= 0 ? idx : 0;
    if (currentIdx >= EDITOR_ZOOM_LEVELS.length - 1) {
      return;
    }
    applyZoom(EDITOR_ZOOM_LEVELS[currentIdx + 1]);
  }, [applyZoom, zoom]);

  const zoomOut = useCallback(() => {
    const idx = EDITOR_ZOOM_LEVELS.findIndex((level) => Math.abs(level - zoom) < 1e-6);
    const currentIdx = idx >= 0 ? idx : 0;
    if (currentIdx <= 0) {
      return;
    }
    applyZoom(EDITOR_ZOOM_LEVELS[currentIdx - 1]);
  }, [applyZoom, zoom]);

  useEffect(() => {
    if (zoom <= 1) {
      setPan({ x: 0, y: 0 });
    }
  }, [zoom]);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) {
      return;
    }
    if (activeTool === "move") {
      panStartClientRef.current = { x: event.clientX, y: event.clientY };
      setIsPanning(true);
      canvasRef.current.setPointerCapture(event.pointerId);
      return;
    }
    strokeStartPixelsRef.current = latestPixelsRef.current.slice();
    const point = getPixelPosition(event, canvasRef.current);
    const packed = activeTool === "erase" ? TRANSPARENT_PIXEL : currentColorPacked;
    setIsDrawing(true);
    setLastPoint(point);
    drawLine(point, point, packed);
    canvasRef.current.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) {
      return;
    }
    if (isPanning && activeTool === "move") {
      const start = panStartClientRef.current;
      if (!start) {
        return;
      }
      const deltaX = event.clientX - start.x;
      const deltaY = event.clientY - start.y;
      panStartClientRef.current = { x: event.clientX, y: event.clientY };
      setPan((previous) => clampPan({ x: previous.x + deltaX, y: previous.y + deltaY }, zoom));
      return;
    }
    if (!isDrawing || !lastPoint) {
      return;
    }
    const point = getPixelPosition(event, canvasRef.current);
    const packed = activeTool === "erase" ? TRANSPARENT_PIXEL : currentColorPacked;
    drawLine(lastPoint, point, packed);
    setLastPoint(point);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (canvasRef.current?.hasPointerCapture(event.pointerId)) {
      canvasRef.current.releasePointerCapture(event.pointerId);
    }
    const strokeStartPixels = strokeStartPixelsRef.current;
    const strokeEndPixels = latestPixelsRef.current;
    if (activeTool !== "move" && strokeStartPixels && !pixelsEqual(strokeStartPixels, strokeEndPixels)) {
      setUndoStack((previous) => {
        const next = [...previous, strokeStartPixels];
        return next.length > MAX_HISTORY_STEPS ? next.slice(next.length - MAX_HISTORY_STEPS) : next;
      });
      setRedoStack([]);
    }
    strokeStartPixelsRef.current = null;
    panStartClientRef.current = null;
    setIsDrawing(false);
    setIsPanning(false);
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
    setEditorMode("editing");
    setSelectedEmojiUuid(emoji.uuid);
    setEmojiName(emoji.name || "Untitled");
    setPixels(decodeDataB64(emoji.data_b64));
    setUndoStack([]);
    setRedoStack([]);
    resetViewport();
    setStatusMessage(`Loaded "${emoji.name || "Untitled"}".`);
  };

  const onNewEmoji = () => {
    setEditorMode("creating");
    setSelectedEmojiUuid(null);
    setEmojiName("Untitled");
    setPixels(new Uint16Array(PIXEL_COUNT).fill(TRANSPARENT_PIXEL));
    setUndoStack([]);
    setRedoStack([]);
    resetViewport();
    setStatusMessage("Started a new emoji.");
  };

  const exitEditor = useCallback(() => {
    setEditorMode("none");
    setSelectedEmojiUuid(null);
    setEmojiName("");
    setPixels(new Uint16Array(PIXEL_COUNT).fill(TRANSPARENT_PIXEL));
    setUndoStack([]);
    setRedoStack([]);
    resetViewport();
  }, [resetViewport]);

  const onCancelEditor = useCallback(() => {
    exitEditor();
    setStatusMessage("");
  }, [exitEditor]);

  useEffect(() => {
    if (editorMode === "none") {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSaving) {
        // Capture + stop so a parent EmojiPicker Escape handler does not also fire.
        event.preventDefault();
        event.stopImmediatePropagation();
        onCancelEditor();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [editorMode, isSaving, onCancelEditor]);

  const onUploadImage = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setStatusMessage("Please upload an image file.");
      return;
    }

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

      setEditorMode("creating");
      setSelectedEmojiUuid(null);
      const inferredName = file.name.replace(/\.[^/.]+$/, "").trim();
      setEmojiName((inferredName || "Untitled").slice(0, 40));
      setUndoStack([]);
      setRedoStack([]);
      setPixels(importedPixels);
      resetViewport();
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
      setEmojis((previous) => {
        const remaining = previous.filter((row) => row.uuid !== saved.uuid);
        return [saved, ...remaining];
      });
      setStatusMessage("Emoji saved.");
      exitEditor();
      onSaved?.();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to save emoji.");
    } finally {
      setIsSaving(false);
    }
  };

  const displayEmojiName = emojiName.trim() || "Untitled";
  const saveButtonLabel =
    editorMode === "editing"
      ? `Save Edits to '${displayEmojiName}'`
      : `Create Emoji '${displayEmojiName}'`;

  const sectionClass = `border-b border-accent-1 px-3 py-3 ${DONT_SWIPE_TABS_CLASSNAME}`;
  const canvasClass = "h-full w-full touch-none rounded border border-accent-1 [image-rendering:pixelated]";
  const thumbBoxClass = "mb-1 h-[20vw] w-[20vw] overflow-hidden rounded";

  useEffect(() => {
    // Avoid leaving transient drag state active when switching tools.
    setIsDrawing(false);
    setIsPanning(false);
    setLastPoint(null);
    panStartClientRef.current = null;
    strokeStartPixelsRef.current = null;
  }, [activeTool]);

  return (
    <section className={sectionClass}>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-semibold text-foreground">Emoji Editor</p>
        {editorMode === "none" ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onNewEmoji}
              className="rounded-lg flex gap-2 border border-accent-1 flex-1 bg-secondary-background px-3 py-3 text-sm text-accent-2 hover:text-foreground"
            >
              <Plus /> New Emoji
            </button>
            <button
              type="button"
              onClick={() => uploadInputRef.current?.click()}
              className="rounded-lg flex gap-2 border border-accent-1 flex-1 bg-secondary-background px-3 py-3 text-sm text-accent-2 hover:text-foreground"
            >
              <ImagePlus /> Upload Image
            </button>
            <input
              ref={uploadInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) {
                  void onUploadImage(file);
                }
              }}
            />
          </div>
        ) : null}
      </div>

      {portalMounted && editorMode !== "none"
        ? createPortal(
          <div
            className={`${DONT_SWIPE_TABS_CLASSNAME} fixed inset-0 z-[2050] flex items-center justify-center px-3 py-4`}
          >
            <div
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={() => {
                if (!isSaving) {
                  onCancelEditor();
                }
              }}
              aria-hidden="true"
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label={editorMode === "editing" ? "Edit emoji" : "Create emoji"}
              className="relative flex h-[min(92dvh,900px)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-accent-1 bg-secondary-background p-3 shadow-xl shadow-black/40"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="shrink-0">
                  <p className="mb-2 text-sm font-semibold text-foreground">
                    {editorMode === "editing" ? "Edit Emoji" : "Create Emoji"}
                  </p>
                  <div className="mb-1">
                    <label className="mb-1 block text-xs text-accent-2" htmlFor="emoji-name-input">Name</label>
                    <input
                      id="emoji-name-input"
                      type="text"
                      value={emojiName}
                      onChange={(event) => setEmojiName(event.target.value)}
                      maxLength={40}
                      className="w-full rounded-lg border border-accent-1 bg-primary-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent-2"
                      placeholder="Enter emoji name..."
                    />
                  </div>

                  <div className="mb-2 rounded-lg py-1">
                    <PixelGradientSlider
                      id="emoji-color-slider"
                      min={0}
                      max={1023}
                      value={spectrumPosition}
                      onChange={setSpectrumPosition}
                      colorAt={spectrumPositionToCssColor}
                      aria-label="Hue"
                    />

                    <div className="mt-1 flex gap-4">
                      <div className="mt-1 flex-1">
                        <label className="block text-xs text-accent-2" htmlFor="emoji-shade-slider">
                          Shade
                        </label>
                        <PixelGradientSlider
                          id="emoji-shade-slider"
                          min={0}
                          max={BRIGHTNESS_MAX}
                          value={brightness}
                          onChange={setBrightness}
                          colorAt={shadeColorAt}
                          aria-label="Shade"
                        />
                      </div>
                      <div className="mt-1 flex-1">
                        <label className="block text-xs text-accent-2" htmlFor="emoji-thickness-slider">
                          Thickness
                        </label>
                        <TriangleThicknessSlider
                          id="emoji-thickness-slider"
                          min={0.01}
                          max={8}
                          step={0.01}
                          value={thickness}
                          onChange={setThickness}
                          aria-label="Thickness"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="mb-1 flex shrink-0 items-center justify-between px-1 text-[11px] text-accent-2">
                    <div className="flex items-center gap-1 rounded-lg border border-accent-1 bg-primary-background">
                      {[
                        { id: "draw" as const, label: "", icon: Brush },
                        { id: "move" as const, label: "", icon: Hand },
                        { id: "erase" as const, label: "", icon: Eraser },
                      ].map((tool) => {
                        const Icon = tool.icon;
                        const selected = activeTool === tool.id;
                        return (
                          <button
                            key={tool.id}
                            type="button"
                            onClick={() => setActiveTool(tool.id)}
                            className={`flex items-center gap-1 rounded-md px-2 py-2 text-xs ${
                              selected ? "bg-accent-3 text-primary-background" : "text-accent-2 hover:text-foreground"
                            }`}
                            title={tool.label}
                          >
                            <Icon size={20} />
                            <span>{tool.label}</span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={onUndo}
                        disabled={undoStack.length === 0}
                        className="flex items-center justify-center rounded-lg border border-accent-1 bg-primary-background px-2 py-2 text-accent-2 hover:text-foreground disabled:opacity-40 disabled:hover:text-accent-2"
                        title="Undo"
                        aria-label="Undo"
                      >
                        <Undo2 size={20} />
                      </button>
                      <button
                        type="button"
                        onClick={onRedo}
                        disabled={redoStack.length === 0}
                        className="flex items-center justify-center rounded-lg border border-accent-1 bg-primary-background px-2 py-2 text-accent-2 hover:text-foreground disabled:opacity-40 disabled:hover:text-accent-2"
                        title="Redo"
                        aria-label="Redo"
                      >
                        <Redo2 size={20} />
                      </button>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={zoomOut}
                        disabled={zoom <= EDITOR_ZOOM_LEVELS[0]}
                        className="flex items-center justify-center rounded-lg border border-accent-1 bg-primary-background px-2 py-2 text-accent-2 hover:text-foreground disabled:opacity-40 disabled:hover:text-accent-2"
                        title="Zoom out"
                        aria-label="Zoom out"
                      >
                        <ZoomOut size={20} />
                      </button>
                      <button
                        type="button"
                        onClick={zoomIn}
                        disabled={zoom >= EDITOR_ZOOM_LEVELS[EDITOR_ZOOM_LEVELS.length - 1]}
                        className="flex items-center justify-center rounded-lg border border-accent-1 bg-primary-background px-2 py-2 text-accent-2 hover:text-foreground disabled:opacity-40 disabled:hover:text-accent-2"
                        title="Zoom in"
                        aria-label="Zoom in"
                      >
                        <ZoomIn size={20} />
                      </button>
                    </div>
                  </div>

                  <div className="relative min-h-0 flex-1 [container-type:size]">
                    <div
                      ref={canvasViewportRef}
                      className="absolute left-1/2 top-1/2 aspect-square -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border border-accent-1 bg-primary-background"
                      style={{ width: "min(100cqw, 100cqh)" }}
                    >
                      <canvas
                        ref={canvasRef}
                        width={GRID_SIZE}
                        height={GRID_SIZE}
                        onPointerDown={onPointerDown}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={onPointerUp}
                        style={{
                          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                          transformOrigin: "top left",
                          cursor: activeTool === "move" ? (isPanning ? "grabbing" : "grab") : "crosshair",
                        }}
                        className={canvasClass}
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-2 flex shrink-0 flex-col gap-2">
                  {statusMessage ? <p className="text-xs text-accent-2">{statusMessage}</p> : null}
                  <button
                    type="button"
                    onClick={() => { void onSaveEmoji(); }}
                    disabled={isSaving}
                    className="w-full rounded-lg bg-accent-3 px-3 py-2 text-sm font-semibold text-primary-background disabled:opacity-50"
                  >
                    {isSaving ? "Saving..." : saveButtonLabel}
                  </button>
                  <button
                    type="button"
                    onClick={onCancelEditor}
                    disabled={isSaving}
                    className="w-full rounded-lg border border-accent-1 bg-primary-background px-3 py-2 text-sm text-accent-2 hover:text-foreground disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )
        : null}

      {editorMode === "none" ? (
        <>
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
                <div className={thumbBoxClass}>
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
        </>
      ) : null}

      {editorMode === "none" && statusMessage ? (
        <p className="mt-3 text-xs text-accent-2">{statusMessage}</p>
      ) : null}
    </section>
  );
}
