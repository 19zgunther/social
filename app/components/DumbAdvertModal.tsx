"use client";

import { useEffect, useRef, useState } from "react";

const TARGET_USER_IDS = ["149755c6-e62f-43d6-a476-a88afcba439f", "9b4ccfec-9fa6-4fe4-bea7-f8122ae4bb29", "2e432834-dcda-4197-a743-457cfc219fa2", "3df596f3-a0b6-44b4-af39-a3688c78edd9"];
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const STORAGE_KEY = "dumb_advert_payload_v1";

type BackgroundKind = "flag" | "cross";

type StoredAdvertPayload = {
  shown_at: number;
  advert_text: string;
  background_kind: BackgroundKind;
  topic: "politics" | "religion";
};

type AdvertApiResponse = {
  advert_text?: string;
  background_kind?: BackgroundKind;
  topic?: "politics" | "religion";
};

const drawFlag = (canvas: HTMLCanvasElement) => {
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  const width = canvas.width;
  const height = canvas.height;
  const stripeHeight = height / 13;

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  for (let stripe = 0; stripe < 13; stripe += 1) {
    context.fillStyle = stripe % 2 === 0 ? "#b22234" : "#ffffff";
    context.fillRect(0, stripe * stripeHeight, width, stripeHeight);
  }

  const cantonWidth = width * 0.4;
  const cantonHeight = stripeHeight * 7;
  context.fillStyle = "#3c3b6e";
  context.fillRect(0, 0, cantonWidth, cantonHeight);

  context.fillStyle = "#ffffff";
  const rows = 9;
  const columns = 11;
  const xSpacing = cantonWidth / (columns + 1);
  const ySpacing = cantonHeight / (rows + 1);
  for (let row = 0; row < rows; row += 1) {
    const offset = row % 2 === 0 ? 0 : xSpacing / 2;
    for (let column = 0; column < columns; column += 1) {
      const x = xSpacing * (column + 1) - offset;
      const y = ySpacing * (row + 1);
      if (x > 8 && x < cantonWidth - 8) {
        context.beginPath();
        context.arc(x, y, 2.2, 0, Math.PI * 2);
        context.fill();
      }
    }
  }
};

const drawCross = (canvas: HTMLCanvasElement) => {
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  context.fillStyle = "#d1d5db";
  const verticalWidth = Math.max(22, width * 0.11);
  const horizontalHeight = Math.max(22, height * 0.11);
  const verticalX = width / 2 - verticalWidth / 2;
  const verticalY = height * 0.16;
  const verticalHeight = height * 0.7;
  const horizontalX = width * 0.29;
  const horizontalY = height * 0.36;
  const horizontalWidth = width * 0.42;

  context.fillRect(verticalX, verticalY, verticalWidth, verticalHeight);
  context.fillRect(horizontalX, horizontalY, horizontalWidth, horizontalHeight);
};

const loadStoredPayload = (): StoredAdvertPayload | null => {
  const rawValue = window.localStorage.getItem(STORAGE_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<StoredAdvertPayload>;
    if (
      typeof parsed.shown_at !== "number" ||
      typeof parsed.advert_text !== "string" ||
      (parsed.background_kind !== "flag" && parsed.background_kind !== "cross") ||
      (parsed.topic !== "politics" && parsed.topic !== "religion")
    ) {
      return null;
    }
    return parsed as StoredAdvertPayload;
  } catch {
    return null;
  }
};

export default function DumbAdvertModal({ currentUserId }: { currentUserId: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [payload, setPayload] = useState<StoredAdvertPayload | null>(null);
  const hasRequestedAdvert = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [loadedAt, ___setLoadedAt] = useState<number>(Date.now());
  const [retry, setRetry] = useState<number>(0);

  useEffect(() => {
    if (!TARGET_USER_IDS.includes(currentUserId)) {
      return;
    }

    if (Date.now() - loadedAt < 10 * 1000) {
      setTimeout(() => { setRetry(prev => prev + 1); }, 3);
      return;
    }

    const storedPayload = loadStoredPayload();
    if (storedPayload && Date.now() - storedPayload.shown_at < ONE_DAY_MS) {
      return;
    }

    if (hasRequestedAdvert.current) {
      return;
    }
    hasRequestedAdvert.current = true;

    const requestAdvert = async () => {
      try {
        const response = await fetch("/api/advert", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        });

        if (!response.ok) {
          return;
        }

        const result = (await response.json()) as AdvertApiResponse;
        if (
          typeof result.advert_text !== "string" ||
          (result.background_kind !== "flag" && result.background_kind !== "cross") ||
          (result.topic !== "politics" && result.topic !== "religion")
        ) {
          return;
        }

        const nextPayload: StoredAdvertPayload = {
          shown_at: Date.now(),
          advert_text: result.advert_text,
          background_kind: result.background_kind,
          topic: result.topic,
        };

        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextPayload));
        setPayload(nextPayload);
        setIsOpen(true);
      } catch (error) {
        console.error("advert_fetch_failed", error);
      }
    };

    void requestAdvert();
  }, [currentUserId, retry]);

  useEffect(() => {
    if (!isOpen || !payload || !canvasRef.current) {
      return;
    }

    if (payload.background_kind === "flag") {
      drawFlag(canvasRef.current);
      return;
    }
    drawCross(canvasRef.current);
  }, [isOpen, payload]);

  if (!isOpen || !payload || !TARGET_USER_IDS.includes(currentUserId)) {
    return null;
  }

  return (
    <div className="absolute inset-0 z-[9998] flex items-center justify-center bg-white/75 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Fake ad"
        className="relative w-full max-w-md overflow-hidden rounded-xl border border-black/20 bg-white shadow-2xl"
      >
        <button
          type="button"
          aria-label="Close fake ad"
          onClick={() => setIsOpen(false)}
          className="absolute left-2 top-2 z-20 rounded border border-black/40 bg-white px-2 py-1 text-sm font-bold text-black hover:bg-black hover:text-white"
        >
          X
        </button>

        <canvas
          ref={canvasRef}
          width={640}
          height={420}
          className="absolute inset-0 h-full w-full opacity-35"
          aria-hidden="true"
        />

        <div className="relative z-10 p-6 pt-12">
          <p className="text-center text-xl font-bold text-black leading-snug">
            {payload.advert_text}
          </p>
        </div>
      </div>
    </div>
  );
}
