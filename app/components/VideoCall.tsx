"use client";

import type { MutableRefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { PhoneOff, Video } from "lucide-react";
import {
  createVideoCallController,
  type VideoCallController,
  type VideoCallSignal,
  type VideoCallStatus,
} from "@/app/components/utils/webrtcVideoCall";

type VideoCallProps = {
  threadId: string;
  currentUserId: string;
  onBack: () => void;
};

type SignallingRow = {
  id: string;
  call_session_id: string;
  from_user_id: string;
  created_at: string;
  payload: unknown;
};

const postWithAuth = async (path: string, body: unknown): Promise<Response> => {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
};

const VIDEO_SIGNAL_POLL_INTERVAL_MS = 5_000;

const isVideoCallSignalPayload = (value: unknown): value is VideoCallSignal => {
  if (!value || typeof value !== "object" || !("type" in value)) {
    return false;
  }
  const t = (value as { type: unknown }).type;
  return t === "offer" || t === "answer" || t === "ice";
};

/** Advance cursor and apply remote signals; skips unrelated sessions without losing cursor progress. */
const applySignallingRows = async (
  rows: SignallingRow[],
  currentUserId: string,
  callSessionIdRef: MutableRefObject<string | null>,
  pollCursorRef: MutableRefObject<{ created_at: string; id: string } | null>,
  processedSignalIdsRef: MutableRefObject<Set<string>>,
  controllerRef: MutableRefObject<VideoCallController | null>,
) => {
  for (const row of rows) {
    pollCursorRef.current = { created_at: row.created_at, id: row.id };

    if (processedSignalIdsRef.current.has(row.id)) {
      continue;
    }

    if (!isVideoCallSignalPayload(row.payload)) {
      processedSignalIdsRef.current.add(row.id);
      continue;
    }

    const sig = row.payload;

    if (!callSessionIdRef.current) {
      if (sig.type !== "offer" || row.from_user_id === currentUserId) {
        processedSignalIdsRef.current.add(row.id);
        continue;
      }
      callSessionIdRef.current = row.call_session_id;
    } else if (row.call_session_id !== callSessionIdRef.current) {
      processedSignalIdsRef.current.add(row.id);
      continue;
    }

    processedSignalIdsRef.current.add(row.id);
    await controllerRef.current?.handleRemoteSignal(sig);
  }
};

export default function VideoCall({ threadId, currentUserId, onBack }: VideoCallProps) {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const controllerRef = useRef<VideoCallController | null>(null);
  const [status, setStatus] = useState<VideoCallStatus>("idle");
  const [statusDetail, setStatusDetail] = useState<string | undefined>();
  const processedSignalIdsRef = useRef<Set<string>>(new Set());
  const callSessionIdRef = useRef<string | null>(null);
  const pollCursorRef = useRef<{ created_at: string; id: string } | null>(null);
  const notBeforeRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    notBeforeRef.current = new Date(Date.now() - 60_000).toISOString();
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const localVideo = localVideoRef.current;
    const remoteVideo = remoteVideoRef.current;
    if (!localVideo || !remoteVideo) {
      return;
    }

    const sendSignal = async (signal: VideoCallSignal) => {
      const sessionId = callSessionIdRef.current;
      if (!sessionId) {
        return;
      }
      const response = await postWithAuth("/api/webrtc-signalling-send", {
        thread_id: threadId,
        call_session_id: sessionId,
        payload: signal,
      });
      if (!response.ok && response.status !== 401) {
        console.error("webrtc_signalling_send_failed", response.status);
      }
    };

    controllerRef.current = createVideoCallController({
      currentUserId,
      localVideoElement: localVideo,
      remoteVideoElement: remoteVideo,
      sendSignal,
      onStatusChange: (nextStatus, detail) => {
        setStatus(nextStatus);
        setStatusDetail(detail);
      },
    });

    return () => {
      controllerRef.current?.endCall();
      controllerRef.current = null;
    };
  }, [currentUserId, threadId]);

  useEffect(() => {
    let cancelled = false;

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const pollSignals = async () => {
      while (!cancelled && isMountedRef.current) {
        try {
          const notBefore = notBeforeRef.current;
          if (!notBefore) {
            await sleep(VIDEO_SIGNAL_POLL_INTERVAL_MS);
            continue;
          }

          const pollBody: Record<string, unknown> = {
            thread_id: threadId,
          };
          if (callSessionIdRef.current) {
            pollBody.call_session_id = callSessionIdRef.current;
          }
          if (pollCursorRef.current) {
            pollBody.cursor = pollCursorRef.current;
          } else {
            pollBody.not_before = notBefore;
          }

          const pollResponse = await postWithAuth("/api/webrtc-signalling-poll", pollBody);

          if (!pollResponse.ok) {
            if (pollResponse.status === 401) {
              return;
            }
            await sleep(VIDEO_SIGNAL_POLL_INTERVAL_MS);
            continue;
          }

          const pollPayload = (await pollResponse.json()) as { signals: SignallingRow[] };
          await applySignallingRows(
            pollPayload.signals ?? [],
            currentUserId,
            callSessionIdRef,
            pollCursorRef,
            processedSignalIdsRef,
            controllerRef,
          );
        } catch {
          // Temporary failure, retry after delay.
        }

        await sleep(VIDEO_SIGNAL_POLL_INTERVAL_MS);
      }
    };

    void pollSignals();

    return () => {
      cancelled = true;
    };
  }, [currentUserId, threadId]);

  const onStartCall = async () => {
    if (!controllerRef.current) {
      return;
    }
    callSessionIdRef.current = crypto.randomUUID();
    pollCursorRef.current = null;
    processedSignalIdsRef.current.clear();
    try {
      await controllerRef.current.startCall();
      const notBefore = notBeforeRef.current;
      if (!notBefore) {
        return;
      }
      try {
        const pollBody: Record<string, unknown> = {
          thread_id: threadId,
          call_session_id: callSessionIdRef.current,
        };
        if (pollCursorRef.current) {
          pollBody.cursor = pollCursorRef.current;
        } else {
          pollBody.not_before = notBefore;
        }
        const pollResponse = await postWithAuth("/api/webrtc-signalling-poll", pollBody);
        if (!pollResponse.ok) {
          return;
        }
        const pollPayload = (await pollResponse.json()) as { signals: SignallingRow[] };
        await applySignallingRows(
          pollPayload.signals ?? [],
          currentUserId,
          callSessionIdRef,
          pollCursorRef,
          processedSignalIdsRef,
          controllerRef,
        );
      } catch {
        // Best-effort; polling loop continues.
      }
    } catch {
      // Error state is handled by controller's status callback.
    }
  };

  const onEndCall = () => {
    controllerRef.current?.endCall();
    onBack();
  };

  const renderStatusLabel = () => {
    if (status === "idle") {
      return "Ready to start a call.";
    }
    if (status === "acquiring_media") {
      return "Accessing camera and microphone...";
    }
    if (status === "waiting_for_peer") {
      return "Calling other members...";
    }
    if (status === "ringing") {
      return "Incoming call...";
    }
    if (status === "connecting") {
      return "Connecting...";
    }
    if (status === "connected") {
      return "Connected";
    }
    if (status === "ended") {
      return "Call ended.";
    }
    if (status === "error") {
      return statusDetail ?? "Call error.";
    }
    return "";
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-primary-background">
      <div className="flex items-center justify-between border-b border-accent-1 bg-secondary-background px-3 py-3">
        <button
          type="button"
          onClick={onEndCall}
          className="rounded-full border border-accent-1 px-3 py-1 text-xs text-accent-2 hover:text-foreground"
        >
          Back
        </button>
        <div className="flex items-center gap-2">
          <Video className="h-4 w-4 text-accent-2" />
          <p className="text-sm font-semibold text-foreground">Video call</p>
        </div>
        <button
          type="button"
          onClick={onEndCall}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-red-600 text-primary-background hover:bg-red-500"
        >
          <PhoneOff className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 min-h-0 bg-black">
        <div className="relative flex h-full w-full flex-col">
          <video
            ref={remoteVideoRef}
            className="h-full w-full object-cover"
            autoPlay
            playsInline
          />
          <video
            ref={localVideoRef}
            className="pointer-events-none absolute bottom-3 right-3 h-32 w-24 rounded-xl border border-accent-1 object-cover shadow-lg shadow-black/60"
            muted
            autoPlay
            playsInline
          />
        </div>
      </div>

      <div className="border-t border-accent-1 bg-secondary-background px-3 py-2">
        <p className="text-xs text-accent-2">{renderStatusLabel()}</p>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={onStartCall}
            disabled={status === "acquiring_media" || status === "connecting"}
            className="flex-1 rounded-full bg-accent-3 px-4 py-2 text-xs font-semibold text-primary-background hover:brightness-110 disabled:opacity-60"
          >
            {status === "connected" ? "Reconnect" : "Start call"}
          </button>
        </div>
      </div>
    </div>
  );
}

