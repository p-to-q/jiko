import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  createBrowserSession,
  postRecordingStarted,
  resolveApiBaseUrl,
  toErrorMessage,
  uploadSessionAudio,
} from "../api/server";

const HOLD_TO_STOP_MS = 360;
const PREFERRED_AUDIO_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4",
] as const;

export type RecordingStatus =
  | "idle"
  | "requesting"
  | "recording"
  | "uploading"
  | "error";

export type RecordingControlState = {
  status: RecordingStatus;
  error?: string;
  lastDurationMs?: number;
};

export type RecorderPointerHandlers = {
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
};

export type RecorderControls = {
  sessionId?: string;
  recording: RecordingControlState;
  ensureSession: () => Promise<string>;
  pointerHandlers: RecorderPointerHandlers;
};

export function useRecorder(currentSessionId?: string): RecorderControls {
  const apiBaseUrl = useMemo(resolveApiBaseUrl, []);
  const [recording, setRecording] = useState<RecordingControlState>({
    status: "idle",
  });
  const [localSessionId, setLocalSessionId] = useState<string>();
  const recorderRef = useRef<MediaRecorder>();
  const streamRef = useRef<MediaStream>();
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>();
  const sessionIdRef = useRef<string>();
  const pointerStartedAtRef = useRef<number>();
  const activePointerIdRef = useRef<number>();
  const pendingStopAfterStartRef = useRef(false);
  const recordingStatusRef = useRef<RecordingStatus>("idle");
  const unmountingRef = useRef(false);
  const sessionId = localSessionId ?? currentSessionId;

  const setRecordingStatus = useCallback((next: RecordingControlState) => {
    recordingStatusRef.current = next.status;
    setRecording(next);
  }, []);

  const ensureSession = useCallback(async () => {
    const existingSessionId =
      sessionIdRef.current ?? localSessionId ?? currentSessionId;

    if (existingSessionId) {
      sessionIdRef.current = existingSessionId;
      setLocalSessionId(existingSessionId);
      return existingSessionId;
    }

    const createdSessionId = await createBrowserSession(apiBaseUrl);
    sessionIdRef.current = createdSessionId;
    setLocalSessionId(createdSessionId);
    return createdSessionId;
  }, [apiBaseUrl, currentSessionId, localSessionId]);

  const cleanupMedia = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) {
      track.stop();
    }

    streamRef.current = undefined;
    recorderRef.current = undefined;
  }, []);

  const handleRecordedBlob = useCallback(
    async (blob: Blob, durationMs: number, targetSessionId: string) => {
      setRecordingStatus({
        status: "uploading",
        lastDurationMs: durationMs,
      });

      try {
        await uploadSessionAudio(apiBaseUrl, targetSessionId, blob, durationMs);
        setRecordingStatus({
          status: "idle",
          lastDurationMs: durationMs,
        });
      } catch (error) {
        setRecordingStatus({
          status: "error",
          error: toErrorMessage(error),
          lastDurationMs: durationMs,
        });
      }
    },
    [apiBaseUrl, setRecordingStatus],
  );

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;

    if (!recorder || recorder.state === "inactive") {
      cleanupMedia();
      if (recordingStatusRef.current === "recording") {
        setRecordingStatus({ status: "idle" });
      }
      return;
    }

    pendingStopAfterStartRef.current = false;
    recorder.stop();
  }, [cleanupMedia, setRecordingStatus]);

  const startRecording = useCallback(async () => {
    if (
      recordingStatusRef.current === "requesting" ||
      recordingStatusRef.current === "recording" ||
      recordingStatusRef.current === "uploading"
    ) {
      return;
    }

    if (!canRecordAudio()) {
      setRecordingStatus({
        status: "error",
        error: "Browser audio recording is unavailable.",
      });
      return;
    }

    setRecordingStatus({ status: "requesting" });
    chunksRef.current = [];

    try {
      const targetSessionId = await ensureSession();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getSupportedAudioType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );

      streamRef.current = stream;
      recorderRef.current = recorder;
      sessionIdRef.current = targetSessionId;

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      });

      recorder.addEventListener("stop", () => {
        if (unmountingRef.current) {
          cleanupMedia();
          return;
        }

        const durationMs = Math.max(
          0,
          performance.now() - (startedAtRef.current ?? performance.now()),
        );
        const recordedType = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: recordedType });

        cleanupMedia();

        if (blob.size === 0) {
          setRecordingStatus({
            status: "error",
            error: "Recording was empty.",
            lastDurationMs: durationMs,
          });
          return;
        }

        void handleRecordedBlob(blob, durationMs, targetSessionId);
      });

      await postRecordingStarted(apiBaseUrl, targetSessionId);

      startedAtRef.current = performance.now();
      recorder.start();
      setRecordingStatus({ status: "recording" });

      if (pendingStopAfterStartRef.current) {
        stopRecording();
      }
    } catch (error) {
      cleanupMedia();
      setRecordingStatus({
        status: "error",
        error: toErrorMessage(error),
      });
    }
  }, [
    apiBaseUrl,
    cleanupMedia,
    ensureSession,
    handleRecordedBlob,
    setRecordingStatus,
    stopRecording,
  ]);

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) {
        return;
      }

      if (recordingStatusRef.current === "recording") {
        stopRecording();
        return;
      }

      if (
        recordingStatusRef.current !== "idle" &&
        recordingStatusRef.current !== "error"
      ) {
        return;
      }

      activePointerIdRef.current = event.pointerId;
      pointerStartedAtRef.current = performance.now();
      event.currentTarget.setPointerCapture(event.pointerId);
      void startRecording();
    },
    [startRecording, stopRecording],
  );

  const handlePointerUp = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (activePointerIdRef.current !== event.pointerId) {
        return;
      }

      const elapsedMs =
        performance.now() - (pointerStartedAtRef.current ?? performance.now());

      activePointerIdRef.current = undefined;
      pointerStartedAtRef.current = undefined;

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      if (elapsedMs < HOLD_TO_STOP_MS) {
        return;
      }

      if (recordingStatusRef.current === "requesting") {
        pendingStopAfterStartRef.current = true;
        return;
      }

      stopRecording();
    },
    [stopRecording],
  );

  const handlePointerCancel = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (activePointerIdRef.current !== event.pointerId) {
        return;
      }

      activePointerIdRef.current = undefined;
      pointerStartedAtRef.current = undefined;
      pendingStopAfterStartRef.current = true;
      stopRecording();
    },
    [stopRecording],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();

      if (recordingStatusRef.current === "recording") {
        stopRecording();
        return;
      }

      void startRecording();
    },
    [startRecording, stopRecording],
  );

  useEffect(() => {
    unmountingRef.current = false;

    return () => {
      unmountingRef.current = true;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.stop();
      }
      cleanupMedia();
    };
  }, [cleanupMedia]);

  useEffect(() => {
    if (!currentSessionId) {
      return;
    }

    sessionIdRef.current = currentSessionId;
    setLocalSessionId((existingSessionId) => existingSessionId ?? currentSessionId);
  }, [currentSessionId]);

  return {
    sessionId,
    recording,
    ensureSession,
    pointerHandlers: {
      onKeyDown: handleKeyDown,
      onPointerCancel: handlePointerCancel,
      onPointerDown: handlePointerDown,
      onPointerUp: handlePointerUp,
    },
  };
}

function canRecordAudio() {
  const mediaDevices = globalThis.navigator?.mediaDevices;

  return Boolean(
    mediaDevices &&
      "getUserMedia" in mediaDevices &&
      typeof MediaRecorder !== "undefined",
  );
}

function getSupportedAudioType() {
  return PREFERRED_AUDIO_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}
