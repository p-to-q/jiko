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
  fetchSessionDebugSnapshot,
  postRecordingStarted,
  resolveApiBaseUrl,
  toErrorMessage,
  uploadSessionAudio,
  type SessionDebugSnapshot,
} from "../api/server";
import type { DeviceEventSummary } from "../events/useDeviceEvents";

const HOLD_TO_STOP_MS = 360;
const PREFERRED_AUDIO_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4",
] as const;

type RecordingStatus = "idle" | "requesting" | "recording" | "uploading" | "error";

type RecordingControlState = {
  status: RecordingStatus;
  error?: string;
  lastDurationMs?: number;
};

export function PreviewTools({
  currentSessionId,
  phase,
  recentEvents,
}: {
  currentSessionId?: string;
  phase: string;
  recentEvents: DeviceEventSummary[];
}) {
  const apiBaseUrl = useMemo(resolveApiBaseUrl, []);
  const [recording, setRecording] = useState<RecordingControlState>({
    status: "idle",
  });
  const [localSessionId, setLocalSessionId] = useState<string>();
  const [debugSnapshot, setDebugSnapshot] = useState<SessionDebugSnapshot>({
    status: "idle",
  });
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
  const debugRefreshKey = `${recentEvents[0]?.timestamp ?? ""}:${recentEvents[0]?.type ?? ""}`;
  const sessionId = localSessionId ?? currentSessionId;

  const setRecordingStatus = useCallback((next: RecordingControlState) => {
    recordingStatusRef.current = next.status;
    setRecording(next);
  }, []);

  const refreshDebugSnapshot = useCallback(
    async (targetSessionId: string, signal?: AbortSignal) => {
      setDebugSnapshot({ status: "loading" });

      try {
        const snapshot = await fetchSessionDebugSnapshot(
          apiBaseUrl,
          targetSessionId,
          signal,
        );
        setDebugSnapshot(snapshot);
      } catch (error) {
        if (signal?.aborted) {
          return;
        }

        setDebugSnapshot({
          status: "error",
          message: toErrorMessage(error),
        });
      }
    },
    [apiBaseUrl],
  );

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
        await refreshDebugSnapshot(targetSessionId);
      } catch (error) {
        setRecordingStatus({
          status: "error",
          error: toErrorMessage(error),
          lastDurationMs: durationMs,
        });
      }
    },
    [apiBaseUrl, refreshDebugSnapshot, setRecordingStatus],
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

  useEffect(() => {
    if (!sessionId) {
      setDebugSnapshot({ status: "idle" });
      return;
    }

    const controller = new AbortController();
    void refreshDebugSnapshot(sessionId, controller.signal);

    return () => {
      controller.abort();
    };
  }, [debugRefreshKey, refreshDebugSnapshot, sessionId]);

  return (
    <aside className="preview-tools" aria-label="Browser controls and debug">
      <section className="record-panel" aria-label="Browser recording">
        <div className="panel-header">
          <span>Browser</span>
          <span className={`status-pill status-${recording.status}`}>
            {recording.status}
          </span>
        </div>
        <button
          className="record-button"
          data-recording-state={recording.status}
          disabled={recording.status === "uploading"}
          onKeyDown={handleKeyDown}
          onPointerCancel={handlePointerCancel}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          type="button"
        >
          {recording.status === "recording" ? "Stop" : "Record"}
        </button>
        <dl className="session-facts">
          <div>
            <dt>Session</dt>
            <dd>{sessionId ?? "none"}</dd>
          </div>
          <div>
            <dt>Phase</dt>
            <dd>{phase}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{formatDuration(recording.lastDurationMs)}</dd>
          </div>
        </dl>
        {recording.error ? <p className="panel-error">{recording.error}</p> : null}
      </section>

      <section className="debug-panel" aria-label="Session debug">
        <div className="panel-header">
          <span>Debug</span>
          <button
            className="mini-button"
            disabled={!sessionId}
            onClick={() => {
              if (sessionId) {
                void refreshDebugSnapshot(sessionId);
              }
            }}
            type="button"
          >
            Refresh
          </button>
        </div>
        <RecentEvents events={recentEvents} />
        <DebugSnapshot snapshot={debugSnapshot} />
      </section>
    </aside>
  );
}

function RecentEvents({ events }: { events: DeviceEventSummary[] }) {
  return (
    <div className="events-block">
      <h2>Events</h2>
      {events.length ? (
        <ol className="event-list">
          {events.map((event, index) => (
            <li key={`${event.type}-${event.timestamp ?? index}-${index}`}>
              <span>{event.type}</span>
              <time>{formatEventTime(event.timestamp)}</time>
            </li>
          ))}
        </ol>
      ) : (
        <p className="empty-note">No events yet.</p>
      )}
    </div>
  );
}

function DebugSnapshot({ snapshot }: { snapshot: SessionDebugSnapshot }) {
  if (snapshot.status === "idle") {
    return <p className="empty-note">No session selected.</p>;
  }

  if (snapshot.status === "loading") {
    return <p className="empty-note">Loading debug receipt...</p>;
  }

  if (snapshot.status === "missing" || snapshot.status === "error") {
    return <p className="panel-error">{snapshot.message}</p>;
  }

  const debugFields = getDebugFields(snapshot.payload);

  return (
    <div className="receipt-block">
      <div className="receipt-source">{snapshot.endpoint}</div>
      {debugFields.length ? (
        <dl className="receipt-fields">
          {debugFields.map((field) => (
            <div key={field.label}>
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <pre className="json-preview">{formatJson(snapshot.payload)}</pre>
      )}
    </div>
  );
}

function getDebugFields(payload: unknown) {
  const record = unwrapSessionLikePayload(payload);

  if (!record) {
    return [];
  }

  const transcript = isRecord(record.transcript)
    ? record.transcript
    : isRecord(record.input) && typeof record.input.transcript === "string"
      ? { text: record.input.transcript, language: record.input.language }
      : undefined;
  const features = isRecord(record.features) ? record.features : undefined;
  const result = isRecord(record.result) ? record.result : undefined;
  const readings = Array.isArray(record.readings) ? record.readings : undefined;
  const providers = isRecord(record.providers) ? record.providers : undefined;

  return [
    {
      label: "Transcript",
      value: stringValue(transcript?.text) ?? "pending",
    },
    {
      label: "Features",
      value: summarizeFeatures(features),
    },
    {
      label: "Readings",
      value: summarizeReadings(readings),
    },
    {
      label: "Result",
      value: summarizeResult(result),
    },
    {
      label: "TTS",
      value: summarizeTts(result, providers),
    },
  ];
}

function unwrapSessionLikePayload(payload: unknown) {
  if (!isRecord(payload)) {
    return undefined;
  }

  if (isRecord(payload.session)) {
    return payload.session;
  }

  return payload;
}

function summarizeFeatures(features: Record<string, unknown> | undefined) {
  if (!features) {
    return "pending";
  }

  const visibleKeys = [
    "durationMs",
    "speechMs",
    "silenceMs",
    "pauseCount",
    "rmsMean",
    "pitchMeanHz",
  ];
  const parts = visibleKeys
    .map((key) => {
      const value = features[key];
      return typeof value === "number" || typeof value === "string"
        ? `${key} ${formatDebugValue(value)}`
        : undefined;
    })
    .filter(Boolean);

  return parts.length ? parts.join(" / ") : "pending";
}

function summarizeReadings(readings: unknown[] | undefined) {
  if (!readings?.length) {
    return "pending";
  }

  const parts = readings
    .map((reading) => {
      if (!isRecord(reading)) {
        return undefined;
      }

      const channel = stringValue(reading.channel);
      const state = stringValue(reading.state);

      return channel && state ? `${channel}: ${state}` : undefined;
    })
    .filter(Boolean);

  return parts.length ? parts.join(" / ") : "pending";
}

function summarizeResult(result: Record<string, unknown> | undefined) {
  if (!result) {
    return "pending";
  }

  if (isRecord(result.topWindow)) {
    const lineZh = stringValue(result.topWindow.lineZh);
    const lineEn = stringValue(result.topWindow.lineEn);
    const status = stringValue(result.topWindow.status);

    return lineZh ?? lineEn ?? status ?? "available";
  }

  return "available";
}

function summarizeTts(
  result: Record<string, unknown> | undefined,
  providers: Record<string, unknown> | undefined,
) {
  const tts = isRecord(result?.tts) ? result.tts : undefined;
  const provider = isRecord(providers?.tts) ? providers.tts : undefined;
  const clipKey = stringValue(tts?.clipKey);
  const providerId = stringValue(provider?.id);

  if (!clipKey && !providerId) {
    return "pending";
  }

  return [clipKey ? `clip ${clipKey}` : undefined, providerId]
    .filter(Boolean)
    .join(" / ");
}

function formatDuration(durationMs: number | undefined) {
  if (durationMs === undefined) {
    return "none";
  }

  return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatEventTime(timestamp: number | undefined) {
  if (!timestamp) {
    return "--:--:--";
  }

  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDebugValue(value: number | string) {
  return typeof value === "number" && !Number.isInteger(value)
    ? value.toFixed(2)
    : String(value);
}

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2) ?? "";
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

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
