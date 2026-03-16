export type VideoCallSignal =
  | {
      type: "offer" | "answer";
      sdp: RTCSessionDescriptionInit;
      from_user_id: string;
    }
  | {
      type: "ice";
      candidate: RTCIceCandidateInit;
      from_user_id: string;
    };

export type VideoCallStatus =
  | "idle"
  | "acquiring_media"
  | "waiting_for_peer"
  | "ringing"
  | "connecting"
  | "connected"
  | "ended"
  | "error";

export type VideoCallControllerConfig = {
  currentUserId: string;
  localVideoElement: HTMLVideoElement;
  remoteVideoElement: HTMLVideoElement;
  sendSignal: (signal: VideoCallSignal) => Promise<void> | void;
  onStatusChange?: (status: VideoCallStatus, detail?: string) => void;
};

export type VideoCallController = {
  startCall: () => Promise<void>;
  endCall: () => void;
  handleRemoteSignal: (signal: VideoCallSignal) => Promise<void>;
};

const defaultIceServers: RTCIceServer[] = [
  {
    urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"],
  },
];

export const createVideoCallController = (
  config: VideoCallControllerConfig,
): VideoCallController => {
  let peerConnection: RTCPeerConnection | null = null;
  let localStream: MediaStream | null = null;
  let hasRemoteDescription = false;
  const pendingRemoteIceCandidates: RTCIceCandidateInit[] = [];

  const updateStatus = (status: VideoCallStatus, detail?: string) => {
    if (config.onStatusChange) {
      config.onStatusChange(status, detail);
    }
  };

  const ensurePeerConnection = () => {
    if (peerConnection) {
      return peerConnection;
    }

    peerConnection = new RTCPeerConnection({ iceServers: defaultIceServers });

    peerConnection.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }
      void config.sendSignal({
        type: "ice",
        candidate: event.candidate.toJSON(),
        from_user_id: config.currentUserId,
      });
    };

    peerConnection.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) {
        // eslint-disable-next-line no-param-reassign
        config.remoteVideoElement.srcObject = stream;
      }
    };

    peerConnection.onconnectionstatechange = () => {
      const state = peerConnection?.connectionState;
      if (state === "connected") {
        updateStatus("connected");
      } else if (state === "failed" || state === "disconnected") {
        updateStatus("error", "Connection lost.");
      }
    };

    return peerConnection;
  };

  const attachLocalStream = async () => {
    if (localStream) {
      return localStream;
    }

    updateStatus("acquiring_media");
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: { facingMode: "user" },
    });

    // eslint-disable-next-line no-param-reassign
    config.localVideoElement.srcObject = localStream;

    const pc = ensurePeerConnection();
    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }

    return localStream;
  };

  const startCall = async () => {
    try {
      await attachLocalStream();
      const pc = ensurePeerConnection();
      updateStatus("connecting");

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      if (!pc.localDescription) {
        throw new Error("Missing local description.");
      }

      await config.sendSignal({
        type: "offer",
        sdp: pc.localDescription.toJSON(),
        from_user_id: config.currentUserId,
      });
      updateStatus("waiting_for_peer");
    } catch (error) {
      updateStatus("error", error instanceof Error ? error.message : "Failed to start call.");
      throw error;
    }
  };

  const handleRemoteSignal = async (signal: VideoCallSignal): Promise<void> => {
    if (signal.from_user_id === config.currentUserId) {
      return;
    }

    const pc = ensurePeerConnection();

    if (signal.type === "offer") {
      try {
        await attachLocalStream();
        const remoteDesc = new RTCSessionDescription(signal.sdp);
        await pc.setRemoteDescription(remoteDesc);
        hasRemoteDescription = true;

        // Flush any ICE candidates that arrived before the remote description was set.
        if (pendingRemoteIceCandidates.length > 0) {
          for (const candidate of pendingRemoteIceCandidates.splice(0)) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (error) {
              updateStatus(
                "error",
                error instanceof Error ? error.message : "Failed to add buffered ICE candidate.",
              );
              return;
            }
          }
        }

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        if (!pc.localDescription) {
          throw new Error("Missing local description for answer.");
        }

        await config.sendSignal({
          type: "answer",
          sdp: pc.localDescription.toJSON(),
          from_user_id: config.currentUserId,
        });
        updateStatus("connecting");
      } catch (error) {
        updateStatus("error", error instanceof Error ? error.message : "Failed to handle offer.");
      }
      return;
    }

    if (signal.type === "answer") {
      if (!pc.currentRemoteDescription) {
        try {
          const remoteDesc = new RTCSessionDescription(signal.sdp);
          await pc.setRemoteDescription(remoteDesc);
          hasRemoteDescription = true;

          if (pendingRemoteIceCandidates.length > 0) {
            for (const candidate of pendingRemoteIceCandidates.splice(0)) {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
              } catch (error) {
                updateStatus(
                  "error",
                  error instanceof Error ? error.message : "Failed to add buffered ICE candidate.",
                );
                return;
              }
            }
          }
          updateStatus("connecting");
        } catch (error) {
          updateStatus(
            "error",
            error instanceof Error ? error.message : "Failed to handle answer.",
          );
        }
      }
      return;
    }

    if (signal.type === "ice") {
      if (!signal.candidate) {
        return;
      }

      if (!hasRemoteDescription) {
        // Buffer ICE candidates until a remote description is set, then flush them.
        pendingRemoteIceCandidates.push(signal.candidate);
        return;
      }

      try {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      } catch (error) {
        updateStatus(
          "error",
          error instanceof Error ? error.message : "Failed to add ICE candidate.",
        );
      }
    }
  };

  const endCall = () => {
    updateStatus("ended");

    if (peerConnection) {
      peerConnection.ontrack = null;
      peerConnection.onicecandidate = null;
      peerConnection.onconnectionstatechange = null;
      peerConnection.close();
      peerConnection = null;
    }

    if (localStream) {
      for (const track of localStream.getTracks()) {
        track.stop();
      }
      localStream = null;
    }

    // eslint-disable-next-line no-param-reassign
    config.localVideoElement.srcObject = null;
    // eslint-disable-next-line no-param-reassign
    config.remoteVideoElement.srcObject = null;
  };

  return {
    startCall,
    endCall,
    handleRemoteSignal,
  };
};

