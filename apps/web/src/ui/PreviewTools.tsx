import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchSessionDebugSnapshot,
  resolveApiBaseUrl,
  submitManualTranscript,
  toErrorMessage,
  type SessionDebugSnapshot,
} from "../api/server";
import type { DeviceEventSummary } from "../events/useDeviceEvents";
import type { RecorderControls, RecordingStatus } from "../events/useRecorder";

const STATUS_LABELS: Record<RecordingStatus, string> = {
  idle: "待机",
  requesting: "请求中",
  recording: "录音中",
  uploading: "上传中",
  error: "错误",
};

const PHASE_LABELS: Record<string, string> = {
  idle: "待机",
  recording: "录音",
  processing: "处理中",
  result: "结果",
  error: "错误",
};

type PanelStatus = "idle" | "requesting" | "uploading" | "error";

type PanelControlState = {
  status: PanelStatus;
  error?: string;
};

export function PreviewTools({
  recorder,
  phase,
  recentEvents,
}: {
  recorder: RecorderControls;
  phase: string;
  recentEvents: DeviceEventSummary[];
}) {
  const apiBaseUrl = useMemo(resolveApiBaseUrl, []);
  const [debugSnapshot, setDebugSnapshot] = useState<SessionDebugSnapshot>({
    status: "idle",
  });
  const [manualTranscript, setManualTranscript] = useState("");
  const [manualStatus, setManualStatus] = useState<PanelControlState>({
    status: "idle",
  });
  const debugRefreshKey = `${recentEvents[0]?.timestamp ?? ""}:${recentEvents[0]?.type ?? ""}`;
  const sessionId = recorder.sessionId;
  const recording = recorder.recording;

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

  const handleManualSubmit = useCallback(async () => {
    const transcript = manualTranscript.trim();

    if (!transcript || manualStatus.status === "requesting" || manualStatus.status === "uploading") {
      return;
    }

    setManualStatus({ status: "requesting" });

    try {
      const targetSessionId = await recorder.ensureSession();
      await submitManualTranscript(apiBaseUrl, targetSessionId, transcript);
      setManualStatus({ status: "idle" });
      await refreshDebugSnapshot(targetSessionId);
    } catch (error) {
      setManualStatus({
        status: "error",
        error: toErrorMessage(error),
      });
    }
  }, [
    apiBaseUrl,
    recorder,
    manualStatus.status,
    manualTranscript,
    refreshDebugSnapshot,
  ]);

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
    <aside className="preview-tools" aria-label="预览控制台">
      <header className="tools-head">
        <span className="tools-title">jiko</span>
        <span className="tools-subtitle">预览控制台</span>
      </header>

      <section className="record-panel" aria-label="说话">
        <div className="panel-header">
          <span>说话</span>
          <span className={`status-pill status-${recording.status}`}>
            {STATUS_LABELS[recording.status]}
          </span>
        </div>
        <button
          className="record-button"
          data-recording-state={recording.status}
          disabled={recording.status === "uploading"}
          {...recorder.pointerHandlers}
          type="button"
        >
          {recording.status === "recording" ? "停止" : "按住说话"}
        </button>
        <dl className="session-facts">
          <div>
            <dt>会话</dt>
            <dd>{sessionId ?? "—"}</dd>
          </div>
          <div>
            <dt>阶段</dt>
            <dd>{PHASE_LABELS[phase] ?? phase}</dd>
          </div>
          <div>
            <dt>时长</dt>
            <dd>{formatDuration(recording.lastDurationMs)}</dd>
          </div>
        </dl>
        {recording.error ? <p className="panel-error">{recording.error}</p> : null}
      </section>

      <section className="manual-panel" aria-label="Manual transcript fallback">
        <div className="panel-header">
          <span>Fallback</span>
          <span className={`status-pill status-${manualStatus.status}`}>
            {manualStatus.status}
          </span>
        </div>
        <textarea
          className="manual-input"
          onChange={(event) => {
            setManualTranscript(event.target.value);
          }}
          placeholder="我在考虑辞职，但还想先把这件事说清楚。"
          rows={3}
          value={manualTranscript}
        />
        <button
          className="mini-button manual-submit"
          disabled={!manualTranscript.trim() || manualStatus.status === "requesting"}
          onClick={handleManualSubmit}
          type="button"
        >
          Send transcript
        </button>
        {manualStatus.error ? <p className="panel-error">{manualStatus.error}</p> : null}
      </section>

      <section className="debug-panel" aria-label="调试">
        <div className="panel-header">
          <span>调试</span>
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
            刷新
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
      <h2>事件</h2>
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
        <p className="empty-note">暂无事件</p>
      )}
    </div>
  );
}

function DebugSnapshot({ snapshot }: { snapshot: SessionDebugSnapshot }) {
  if (snapshot.status === "idle") {
    return <p className="empty-note">未选择会话</p>;
  }

  if (snapshot.status === "loading") {
    return <p className="empty-note">载入回执…</p>;
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
      label: "转写",
      value: stringValue(transcript?.text) ?? "待生成",
    },
    {
      label: "特征",
      value: summarizeFeatures(features),
    },
    {
      label: "读数",
      value: summarizeReadings(readings),
    },
    {
      label: "结果",
      value: summarizeResult(result),
    },
    {
      label: "语音",
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
    return "待生成";
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

  return parts.length ? parts.join(" / ") : "待生成";
}

function summarizeReadings(readings: unknown[] | undefined) {
  if (!readings?.length) {
    return "待生成";
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

  return parts.length ? parts.join(" / ") : "待生成";
}

function summarizeResult(result: Record<string, unknown> | undefined) {
  if (!result) {
    return "待生成";
  }

  if (isRecord(result.topWindow)) {
    const lineZh = stringValue(result.topWindow.lineZh);
    const lineEn = stringValue(result.topWindow.lineEn);
    const status = stringValue(result.topWindow.status);

    return lineZh ?? lineEn ?? status ?? "已生成";
  }

  return "已生成";
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
    return "待生成";
  }

  return [clipKey ? `clip ${clipKey}` : undefined, providerId]
    .filter(Boolean)
    .join(" / ");
}

function formatDuration(durationMs: number | undefined) {
  if (durationMs === undefined) {
    return "—";
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

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
