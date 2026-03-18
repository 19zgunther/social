"use client";

import { ChangeEvent, PointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { Circle, RotateCcw, Send, Undo2, X } from "lucide-react";

type CameraFacingMode = "environment" | "user";

type CameraProps = {
  isOpen: boolean;
  onClose: () => void;
  onSendPhoto: (payload: {
    file: File;
    overlayText: string;
    overlayYRatio: number;
  }) => Promise<void>;
  isSending: boolean;
};

const clampOverlayYRatio = (value: number): number => Math.min(0.9, Math.max(0.1, value));

export default function Camera({ isOpen, onClose, onSendPhoto, isSending }: CameraProps) {
  const [isStartingCamera, setIsStartingCamera] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [cameraErrorMessage, setCameraErrorMessage] = useState("");
  const [cameraFacingMode, setCameraFacingMode] = useState<CameraFacingMode>("environment");
  const [isMirrored, setIsMirrored] = useState(true);
  const [capturedPhotoFile, setCapturedPhotoFile] = useState<File | null>(null);
  const [capturedPhotoPreviewUrl, setCapturedPhotoPreviewUrl] = useState<string | null>(null);
  const [overlayText, setOverlayText] = useState("");
  const [overlayYRatio, setOverlayYRatio] = useState(0.5);
  const [isOverlayVisible, setIsOverlayVisible] = useState(false);
  const [isOverlayTextEditing, setIsOverlayTextEditing] = useState(false);
  const [isDraggingOverlay, setIsDraggingOverlay] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const overlayContainerRef = useRef<HTMLDivElement | null>(null);
  const overlayTextInputRef = useRef<HTMLInputElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("camera_mirror_enabled");
      if (stored === null) {
        setIsMirrored(true);
      } else {
        setIsMirrored(stored === "true");
      }
    } catch {
      setIsMirrored(true);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("camera_mirror_enabled", isMirrored ? "true" : "false");
    } catch {
      // Ignore storage errors
    }
  }, [isMirrored]);

  const stopCameraStream = useCallback(() => {
    const stream = cameraStreamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      cameraStreamRef.current = null;
    }

    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null;
    }
  }, []);

  const attachCameraStreamToVideo = useCallback(async (stream: MediaStream) => {
    const videoElement = cameraVideoRef.current;
    if (!videoElement) {
      return;
    }

    videoElement.srcObject = stream;
    try {
      await videoElement.play();
    } catch {
      setCameraErrorMessage("Could not start camera preview.");
    }
  }, []);

  const startCameraStream = useCallback(
    async (facingMode: CameraFacingMode): Promise<boolean> => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraErrorMessage("Camera not supported on this device/browser.");
        return false;
      }

      const tryGetStream = async (
        mode: CameraFacingMode,
        useExactConstraint: boolean,
      ): Promise<MediaStream> => {
        const facingModeConstraint = useExactConstraint ? { exact: mode } : { ideal: mode };
        return navigator.mediaDevices.getUserMedia({
          video: { facingMode: facingModeConstraint },
          audio: false,
        });
      };

      const fallbackMode: CameraFacingMode = facingMode === "environment" ? "user" : "environment";
      const attempts: Array<{ mode: CameraFacingMode; exact: boolean }> = [
        { mode: facingMode, exact: true },
        { mode: facingMode, exact: false },
        { mode: fallbackMode, exact: false },
      ];

      for (const attempt of attempts) {
        try {
          stopCameraStream();
          const stream = await tryGetStream(attempt.mode, attempt.exact);
          cameraStreamRef.current = stream;
          await attachCameraStreamToVideo(stream);
          setCameraErrorMessage("");
          return true;
        } catch {
          continue;
        }
      }

      setCameraErrorMessage("Unable to access camera.");
      return false;
    },
    [attachCameraStreamToVideo, stopCameraStream],
  );

  useEffect(() => {
    if (!isOpen) {
      stopCameraStream();
      setCapturedPhotoFile(null);
      setCapturedPhotoPreviewUrl(null);
      setOverlayText("");
      setOverlayYRatio(0.5);
      setIsOverlayVisible(false);
      setIsOverlayTextEditing(false);
      setIsDraggingOverlay(false);
      setCameraErrorMessage("");
      return;
    }

    if (capturedPhotoFile) {
      return;
    }

    let cancelled = false;
    const run = async () => {
      setIsStartingCamera(true);
      const started = await startCameraStream(cameraFacingMode);
      if (!cancelled && !started) {
        setCameraErrorMessage("Unable to access camera.");
      }
      if (!cancelled) {
        setIsStartingCamera(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
      stopCameraStream();
    };
  }, [cameraFacingMode, capturedPhotoFile, isOpen, startCameraStream, stopCameraStream]);

  const onFlipCamera = async () => {
    if (isStartingCamera) {
      return;
    }

    const nextFacingMode: CameraFacingMode =
      cameraFacingMode === "environment" ? "user" : "environment";
    setIsStartingCamera(true);
    const streamStarted = await startCameraStream(nextFacingMode);
    if (streamStarted) {
      setCameraFacingMode(nextFacingMode);
    }
    setIsStartingCamera(false);
  };

  const onCapturePhoto = async () => {
    const videoElement = cameraVideoRef.current;
    if (!videoElement || videoElement.videoWidth <= 0 || videoElement.videoHeight <= 0) {
      setCameraErrorMessage("Camera is still warming up. Try again.");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setCameraErrorMessage("Unable to access camera frame.");
      return;
    }

    context.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    const imageBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.92);
    });

    if (!imageBlob) {
      setCameraErrorMessage("Failed to capture photo.");
      return;
    }

    setIsCapturing(true);
    try {
      const capturedFile = new File([imageBlob], `capture-${Date.now()}.jpg`, {
        type: "image/jpeg",
      });
      stopCameraStream();
      setCapturedPhotoFile(capturedFile);
      setCapturedPhotoPreviewUrl(URL.createObjectURL(capturedFile));
      setOverlayText("");
      setOverlayYRatio(0.5);
      setIsOverlayVisible(false);
      setIsOverlayTextEditing(false);
    } finally {
      setIsCapturing(false);
    }
  };

  const onPickFile = async (file: File) => {
    stopCameraStream();
    setCapturedPhotoFile(file);
    setCapturedPhotoPreviewUrl(URL.createObjectURL(file));
    setOverlayText("");
    setOverlayYRatio(0.5);
    setIsOverlayVisible(false);
    setIsOverlayTextEditing(false);
  };

  const onFileInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    await onPickFile(file);
  };

  const startRetakeFlow = () => {
    if (isStartingCamera) {
      return;
    }
    setCapturedPhotoFile(null);
    setCapturedPhotoPreviewUrl(null);
    setOverlayText("");
    setOverlayYRatio(0.5);
    setIsOverlayVisible(false);
    setIsOverlayTextEditing(false);
    setCameraErrorMessage("");
  };

  const updateOverlayYRatio = (clientY: number) => {
    const container = overlayContainerRef.current;
    if (!container) {
      return;
    }
    const rect = container.getBoundingClientRect();
    if (rect.height <= 0) {
      return;
    }
    setOverlayYRatio(clampOverlayYRatio((clientY - rect.top) / rect.height));
  };

  const onOverlayPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!isDraggingOverlay) {
      return;
    }
    updateOverlayYRatio(event.clientY);
  };

  const onOverlayPointerUp = () => {
    setIsDraggingOverlay(false);
  };

  const onSend = async () => {
    if (!capturedPhotoFile || isSending) {
      return;
    }
    try {
      await onSendPhoto({
        file: capturedPhotoFile,
        overlayText: overlayText.trim(),
        overlayYRatio: clampOverlayYRatio(overlayYRatio),
      });
      onClose();
    } catch (error) {
      setCameraErrorMessage(error instanceof Error ? error.message : "Failed to send photo.");
    }
  };

  const showTextOverlayEditor = () => {
    if (!capturedPhotoFile) {
      return;
    }
    setIsOverlayVisible(true);
    setIsOverlayTextEditing(true);
  };

  useEffect(() => {
    if (!isOverlayTextEditing) {
      return;
    }
    overlayTextInputRef.current?.focus();
    overlayTextInputRef.current?.select();
  }, [isOverlayTextEditing]);

  useEffect(() => {
    return () => {
      if (capturedPhotoPreviewUrl) {
        URL.revokeObjectURL(capturedPhotoPreviewUrl);
      }
    };
  }, [capturedPhotoPreviewUrl]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onFileInputChange}
        className="hidden"
      />
      <div className="flex items-center justify-between px-4 py-3 mt-[2rem]">
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-white/30 bg-black/40 p-2 text-white"
          aria-label="Close camera"
        >
          <X className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => {
            fileInputRef.current?.click();
          }}
          className="rounded-full border border-white/30 bg-black/40 px-3 py-1.5 text-xs font-medium text-white"
        >
          Upload
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        {capturedPhotoPreviewUrl ? (
          <div
            ref={overlayContainerRef}
            className="relative h-full w-full"
            onClick={() => {
              setIsOverlayVisible(true);
              setIsOverlayTextEditing(true);
            }}
            onPointerMove={onOverlayPointerMove}
            onPointerUp={onOverlayPointerUp}
            onPointerCancel={onOverlayPointerUp}
            onPointerLeave={onOverlayPointerUp}
          >
            <img
              src={capturedPhotoPreviewUrl}
              alt="Captured preview"
              className={`h-full w-full object-cover ${isMirrored ? "-scale-x-100" : ""}`}
            />
            <button
              type="button"
              onClick={showTextOverlayEditor}
              className="absolute right-3 top-4 z-10 rounded-full border border-white/30 bg-black/45 px-3 py-1.5 text-xs font-medium text-white"
            >
              Add Text
            </button>
            {isOverlayVisible || overlayText.trim().length > 0 ? (
              <div
                className="absolute left-0 right-0 -translate-y-1/2 bg-black/45 px-3 py-2 text-center text-lg font-semibold text-white touch-none"
                style={{ top: `${overlayYRatio * 100}%` }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  setIsDraggingOverlay(true);
                  updateOverlayYRatio(event.clientY);
                }}
              >
                {isOverlayTextEditing ? (
                  <input
                    ref={overlayTextInputRef}
                    value={overlayText}
                    onPointerDown={(event) => event.stopPropagation()}
                    onChange={(event) => setOverlayText(event.target.value)}
                    onBlur={() => {
                      setIsOverlayTextEditing(false);
                      if (!overlayText.trim()) {
                        setIsOverlayVisible(false);
                      }
                    }}
                    placeholder="Tap to add text"
                    className="w-full bg-transparent text-center text-lg font-semibold text-white outline-none placeholder:text-white/70"
                  />
                ) : overlayText ? (
                  overlayText
                ) : (
                  "Tap to add text"
                )}
              </div>
            ) : null}
          </div>
        ) : (
          <video
            ref={cameraVideoRef}
            className={`h-full w-full object-cover ${isMirrored ? "-scale-x-100" : ""}`}
            autoPlay
            muted
            playsInline
          />
        )}
        {cameraErrorMessage ? (
          <div className="absolute inset-x-4 top-4 rounded-lg bg-black/60 px-3 py-2 text-center text-xs text-white">
            {cameraErrorMessage}
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-center gap-4 px-6 py-6">
        {capturedPhotoFile ? (
          <>
            <button
              type="button"
              onClick={() => {
                void startRetakeFlow();
              }}
              disabled={isStartingCamera || isSending}
              className="rounded-full border border-white/30 bg-white/10 p-3 text-white transition hover:bg-white/20 disabled:opacity-50"
              aria-label="Retake photo"
            >
              <Undo2 className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={() => {
                void onSend();
              }}
              disabled={isSending}
              className="rounded-full border border-white/30 bg-white/10 p-3 text-white transition hover:bg-white/20 disabled:opacity-50"
              aria-label="Send photo"
            >
              <Send className="h-8 w-8" />
            </button>
            <button
              type="button"
              onClick={() => setIsMirrored((previous) => !previous)}
              className="rounded-full border border-white/30 bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/20"
            >
              Mirror {isMirrored ? "On" : "Off"}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                void onFlipCamera();
              }}
              disabled={isStartingCamera || isCapturing}
              className="rounded-full border border-white/30 bg-white/10 p-3 text-white transition hover:bg-white/20 disabled:opacity-50"
              aria-label="Flip camera"
            >
              <RotateCcw className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={() => {
                void onCapturePhoto();
              }}
              disabled={isStartingCamera || isCapturing}
              className="rounded-full border border-white/30 bg-white/10 p-3 text-white transition hover:bg-white/20 disabled:opacity-50"
              aria-label="Capture photo"
            >
              <Circle className="h-12 w-12" />
            </button>
            <button
              type="button"
              onClick={() => setIsMirrored((previous) => !previous)}
              className="rounded-full border border-white/30 bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/20"
            >
              Mirror {isMirrored ? "On" : "Off"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
