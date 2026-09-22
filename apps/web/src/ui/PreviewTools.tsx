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
  connecting: "连接后端",
  authorizing: "等待授权",
  recording: "录音中",
  stopping: "封存中",
  uploading: "分析中",
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
  attemptId,
  lastSequence,
  onManualBusyChange,
}: {
  recorder: RecorderControls;
  phase: string;
  recentEvents: DeviceEventSummary[];
  attemptId?: string;
  lastSequence: number;
  onManualBusyChange: (busy: boolean) => void;
}) {
  const apiBaseUrl = useMemo(resolveApiBaseUrl, []);
  const [debugSnapshot, setDebugSnapshot] = useState<SessionDebugSnapshot>({
    status: "idle",
  });
  const [manualTranscript, setManualTranscript] = useState("");
  const [manualStatus, setManualStatus] = useState<PanelControlState>({
    status: "idle",
  });
  const debugRefreshKey = `${attemptId ?? ""}:${lastSequence}`;
  const sessionId = recorder.sessionId;
  const visibleSessionId = recorder.pendingSessionId ?? sessionId;
  const recording = recorder.recording;
  const manualBusy = isManualBusy(manualStatus.status);
  const recordingBlocksManual = isRecordingBusy(recording.status);

  const updateManualStatus = useCallback(
    (next: PanelControlState) => {
      setManualStatus(next);
      onManualBusyChange(isManualBusy(next.status));
    },
    [onManualBusyChange],
  );

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

    if (!transcript || manualBusy || recordingBlocksManual) {
      return;
    }

    const releaseInputLease = recorder.acquireManualInputLease();
    if (!releaseInputLease) {
      return;
    }

    updateManualStatus({ status: "requesting" });

    try {
      const targetSessionId = await recorder.ensureSession();
      updateManualStatus({ status: "uploading" });
      const payload = await submitManualTranscript(apiBaseUrl, targetSessionId, transcript);
      updateManualStatus({ status: "idle" });
      setDebugSnapshot({
        status: "ok",
        endpoint: "manual-transcript response",
        payload,
      });
    } catch (error) {
      updateManualStatus({
        status: "error",
        error: toErrorMessage(error),
      });
    } finally {
      releaseInputLease();
    }
  }, [
    apiBaseUrl,
    recorder,
    manualBusy,
    manualTranscript,
    recordingBlocksManual,
    updateManualStatus,
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
          disabled={
            manualBusy ||
            recording.status === "connecting" ||
            recording.status === "authorizing" ||
            recording.status === "stopping" ||
            recording.status === "uploading"
          }
          onClick={recorder.toggleRecording}
          type="button"
        >
          {recordButtonLabel(recording.status)}
        </button>
        <p className="record-hint">点击开始，再点击停止。首次使用会弹出麦克风授权。</p>
        <dl className="session-facts">
          <div>
            <dt>会话</dt>
            <dd>{visibleSessionId ?? "—"}{recorder.pendingSessionId ? " · 登记中" : ""}</dd>
          </div>
          <div>
            <dt>阶段</dt>
            <dd>{PHASE_LABELS[phase] ?? phase}</dd>
          </div>
          <div>
            <dt>尝试</dt>
            <dd>{attemptId ?? "—"}</dd>
          </div>
          <div>
            <dt>序号</dt>
            <dd>{lastSequence || "—"}</dd>
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
          disabled={manualBusy || recordingBlocksManual}
          onChange={(event) => {
            setManualTranscript(event.target.value);
          }}
          placeholder="我在考虑辞职，但还想先把这件事说清楚。"
          rows={3}
          value={manualTranscript}
        />
        <button
          className="mini-button manual-submit"
          disabled={
            !manualTranscript.trim() ||
            manualBusy ||
            recordingBlocksManual
          }
          onClick={handleManualSubmit}
          type="button"
        >
          Send transcript
        </button>
        {manualStatus.error ? <p className="panel-error">{manualStatus.error}</p> : null}
      </section>

      <LatestTurn snapshot={debugSnapshot} />

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

function recordButtonLabel(status: RecordingStatus) {
  if (status === "connecting") return "正在连接…";
  if (status === "authorizing") return "请允许麦克风";
  if (status === "recording") return "停止并分析";
  if (status === "stopping") return "正在封存…";
  if (status === "uploading") return "正在分析…";
  if (status === "error") return "重试录音";
  return "开始说话";
}

function isManualBusy(status: PanelStatus) {
  return status === "requesting" || status === "uploading";
}

function isRecordingBusy(status: RecordingStatus) {
  return status !== "idle" && status !== "error";
}

function LatestTurn({ snapshot }: { snapshot: SessionDebugSnapshot }) {
  if (snapshot.status !== "ok") {
    return (
      <section className="turn-panel" aria-label="本轮回执">
        <div className="panel-header">
          <span>本轮回执</span>
          <span className="status-pill">等待输入</span>
        </div>
        <p className="empty-note">完成一次录音或 fallback 后，这里会显示输入、TTS 和三路读数。</p>
      </section>
    );
  }

  const record = unwrapSessionLikePayload(snapshot.payload);
  const transcript = isRecord(record?.transcript) ? record.transcript : undefined;
  const transcriptText = stringValue(transcript?.text);
  const semanticText = stringValue(transcript?.semanticText);
  const sttFailureCode = stringValue(transcript?.failureCode);
  const result = isRecord(record?.result) ? record.result : undefined;
  const features = isRecord(record?.features) ? record.features : undefined;
  const pipeline = isRecord(record?.pipeline) ? record.pipeline : undefined;
  const tts = isRecord(result?.tts) ? result.tts : undefined;
  const readings = Array.isArray(record?.readings) ? record.readings : [];
  const providers = isRecord(record?.providers) ? record.providers : undefined;
  const sttProvider = isRecord(providers?.stt)
    ? stringValue(providers.stt.id)
    : stringValue(transcript?.provider);
  const ttsProvider = isRecord(providers?.tts)
    ? stringValue(providers.tts.id)
    : latestTtsProviderFromEvents(record?.events);
  const simulated = readings.some((reading) =>
    isRecord(reading) &&
    isRecord(reading.features) &&
    stringValue(reading.features.featureSource)?.startsWith("simulated:"),
  );
  const unavailableChannels = readings
    .filter((reading) => isRecord(reading) && reading.availability === "unavailable")
    .map((reading) => isRecord(reading) ? stringValue(reading.channel) : undefined)
    .filter(Boolean);
  const readingEngine = readings
    .map((reading) => isRecord(reading) && isRecord(reading.features)
      ? stringValue(reading.features.readingEngine)
      : undefined)
    .find(Boolean);

  return (
    <section className="turn-panel" aria-label="本轮回执">
      <div className="panel-header">
        <span>本轮回执</span>
        <span className={`status-pill ${simulated ? "status-simulated" : "status-measured"}`}>
          {simulated ? "模拟特征" : "实测音频"}
        </span>
      </div>
      <dl className="turn-fields">
        <div>
          <dt>你说的</dt>
          <dd>{transcriptText ?? "—"}</dd>
        </div>
        {semanticText && semanticText !== transcriptText ? (
          <div>
            <dt>内容输入</dt>
            <dd>{semanticText}</dd>
          </div>
        ) : null}
        <div>
          <dt>系统播报</dt>
          <dd>{stringValue(tts?.text) ?? "—"}</dd>
        </div>
        <div>
          <dt>三路信号</dt>
          <dd>{summarizeReadingsWithConfidence(readings)}</dd>
        </div>
        <div>
          <dt>算法输入</dt>
          <dd>{simulated ? "真实文本；声音与节奏为模拟特征" : summarizeMeasuredInputs(features, transcript)}</dd>
        </div>
        <div>
          <dt>读数引擎</dt>
          <dd>{readingEngine ?? "—"}</dd>
        </div>
        <div>
          <dt>STT</dt>
          <dd>
            {sttProvider ?? "—"}
            {sttFailureCode ? ` · ${sttFailureLabel(sttFailureCode)}` : ""}
          </dd>
        </div>
        <div>
          <dt>TTS</dt>
          <dd>{ttsProvider ?? stringValue(tts?.clipKey) ?? "—"}</dd>
        </div>
        <div>
          <dt>管线</dt>
          <dd>{summarizePipeline(pipeline)}</dd>
        </div>
      </dl>
      {simulated ? (
        <p className="turn-caveat">Fallback 只有真实文本；voice / timing 使用模拟特征，不代表声音分析。</p>
      ) : null}
      {unavailableChannels.length ? (
        <p className="turn-caveat">不可用信号：{unavailableChannels.join(" / ")}。未参与多数判断。</p>
      ) : null}
    </section>
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
  const pipeline = isRecord(record.pipeline) ? record.pipeline : undefined;

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
    {
      label: "管线",
      value: summarizePipeline(pipeline),
    },
  ];
}

function summarizePipeline(pipeline: Record<string, unknown> | undefined) {
  if (!pipeline || !Array.isArray(pipeline.stages)) {
    return "待生成";
  }

  const stages = pipeline.stages
    .map((stage) => {
      if (!isRecord(stage)) {
        return undefined;
      }

      const name = stringValue(stage.stage);
      const status = stringValue(stage.status);
      const latencyMs = numberValue(stage.latencyMs);
      if (!name || !status || latencyMs === undefined) {
        return undefined;
      }

      return `${name} ${status} ${Math.round(latencyMs)}ms`;
    })
    .filter(Boolean);

  return stages.length ? stages.join(" / ") : "待生成";
}

function sttFailureLabel(code: string) {
  if (code === "provider_unavailable") {
    return "未配置";
  }

  if (code === "timed_out") {
    return "超时";
  }

  return "失败";
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

function summarizeReadingsWithConfidence(readings: unknown[]) {
  if (!readings.length) {
    return "待生成";
  }

  const labels: Record<string, string> = {
    text: "内容",
    voice: "声音",
    timing: "节奏",
    maintain: "红",
    deviate: "绿",
    static: "未定",
  };
  const parts = readings.map((reading) => {
    if (!isRecord(reading)) {
      return undefined;
    }

    const channel = stringValue(reading.channel);
    const state = stringValue(reading.state);
    const confidence = typeof reading.confidence === "number"
      ? `${Math.round(reading.confidence * 100)}%`
      : undefined;

    const availability = stringValue(reading.availability);
    const availabilityLabel = availability === "unavailable"
      ? " · 不可用"
      : availability === "simulated"
        ? " · 模拟"
        : "";

    return channel && state
      ? `${labels[channel] ?? channel} ${labels[state] ?? state}${confidence ? ` · ${confidence}` : ""}${availabilityLabel}`
      : undefined;
  }).filter(Boolean);

  return parts.length ? parts.join(" / ") : "待生成";
}

function latestTtsProviderFromEvents(events: unknown) {
  if (!Array.isArray(events)) {
    return undefined;
  }

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!isRecord(event) || event.type !== "tts.finished" || !isRecord(event.provider)) {
      continue;
    }

    return stringValue(event.provider.id);
  }

  return undefined;
}

function summarizeMeasuredInputs(
  features: Record<string, unknown> | undefined,
  transcript: Record<string, unknown> | undefined,
) {
  if (!features) {
    return "待生成";
  }

  const speechMs = numberValue(features.speechMs);
  const pauseCount = numberValue(features.pauseCount);
  const rmsMean = numberValue(features.rmsMean);
  const pitchMeanHz = numberValue(features.pitchMeanHz);
  const latencyMs = numberValue(transcript?.latencyMs);
  return [
    speechMs === undefined ? undefined : `语音 ${(speechMs / 1000).toFixed(1)}s`,
    pauseCount === undefined ? undefined : `停顿 ${pauseCount}`,
    rmsMean === undefined ? undefined : `RMS ${rmsMean.toFixed(3)}`,
    pitchMeanHz === undefined ? undefined : `音高 ${Math.round(pitchMeanHz)}Hz`,
    latencyMs === undefined ? undefined : `STT ${Math.round(latencyMs)}ms`,
  ].filter(Boolean).join(" / ") || "待生成";
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

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
