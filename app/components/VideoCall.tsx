"use client";

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

const postWithAuth = async (path: string, body: unknown): Promise<Response> => {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
};

const VIDEO_SIGNAL_POLL_INTERVAL_MS = 25_000;

export default function VideoCall({ threadId, currentUserId, onBack }: VideoCallProps) {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const controllerRef = useRef<VideoCallController | null>(null);
  const [status, setStatus] = useState<VideoCallStatus>("idle");
  const [statusDetail, setStatusDetail] = useState<string | undefined>();
  const processedMessageIdsRef = useRef<Set<string>>(new Set());
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
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
      await postWithAuth("/api/thread-send", {
        thread_id: threadId,
        text: "",
        message_data: {
          video_call_signal: signal,
        },
      });
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

    const pollSignals = async () => {
      while (!cancelled && isMountedRef.current) {
        try {
          const syncResponse = await postWithAuth("/api/sync", {
            timeout_ms: VIDEO_SIGNAL_POLL_INTERVAL_MS,
            max_events: 20,
          });

          if (!syncResponse.ok) {
            if (syncResponse.status === 401) {
              return;
            }
            continue;
          }

          const syncPayload = (await syncResponse.json()) as {
            events: { id: string; type: string; thread_id: string }[];
          };

          const needsRefresh = syncPayload.events.some(
            (event) => event.thread_id === threadId && event.type === "thread_message_posted",
          );

          if (!needsRefresh) {
            continue;
          }

          const latestResponse = await postWithAuth("/api/thread-messages", {
            thread_id: threadId,
          });
          if (!latestResponse.ok) {
            continue;
          }

          const latestPayload = (await latestResponse.json()) as {
            messages: Array<{
              id: string;
              data: { video_call_signal?: VideoCallSignal } | null;
            }>;
          };

          for (const message of latestPayload.messages) {
            if (!message.data?.video_call_signal) {
              continue;
            }
            if (processedMessageIdsRef.current.has(message.id)) {
              continue;
            }
            processedMessageIdsRef.current.add(message.id);
            await controllerRef.current?.handleRemoteSignal(message.data.video_call_signal);
          }
        } catch {
          // Temporary failure, retry on next loop.
        }
      }
    };

    void pollSignals();

    return () => {
      cancelled = true;
    };
  }, [threadId]);

  const onStartCall = async () => {
    if (!controllerRef.current) {
      return;
    }
    try {
      await controllerRef.current.startCall();
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

