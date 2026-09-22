import { useCallback, useState } from "react";
import {
  useDeviceEvents,
  type DeviceState,
  type LampTone,
  type ReadingChannel,
} from "../events/useDeviceEvents";
import { useRecorder } from "../events/useRecorder";
import { PreviewTools } from "./PreviewTools";
import "../demo.css";
import { IdleClock } from "./IdleClock";
import { SpriteMatrix, type SpriteAnimation, type SpriteName, type SpriteTone } from "./sprites";

// Hardware-screen rhythm: same bare glass face as demo.html, with a large top
// dot-matrix strip and three centered square LED modules.
const STABLE_LAYOUT = {
  topStrip: { x: 34, y: 24, w: 252, h: 76 },
  windows: [
    { x: 106, y: 113, w: 108, h: 108, channel: "text", character: "king" },
    { x: 106, y: 231, w: 108, h: 108, channel: "voice", character: "tree" },
    { x: 106, y: 349, w: 108, h: 108, channel: "timing", character: "oracle" },
  ],
} as const;

const PHASE_TAGS: Record<DeviceState["phase"], string> = {
  idle: "待机",
  recording: "录音",
  processing: "处理中",
  result: "结果",
  error: "错误",
};

// Device phase drives which sprite scene the King/Tree/Oracle play.
const PHASE_ANIMATIONS: Record<DeviceState["phase"], SpriteAnimation> = {
  idle: "idle",
  recording: "listening",
  processing: "reading",
  result: "locked",
  error: "sleep",
};

function px(value: number) {
  return `${value}px`;
}

export function DevicePreview() {
  const searchParams = new URLSearchParams(window.location.search);
  const mode = searchParams.get("mode") === "device" ? "device" : "preview";
  const [activeSessionId, setActiveSessionId] = useState<string>();
  const [manualBusy, setManualBusy] = useState(false);
  const browserRecordingAvailable =
    window.isSecureContext &&
    typeof navigator.mediaDevices?.getUserMedia === "function";
  const selectActiveSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
  }, []);
  const eventsState = useDeviceEvents({
    activeSessionId,
    discoverDeviceSessions: mode === "device",
    onSessionDiscovered: selectActiveSession,
  });
  const deviceState = eventsState.device;
  const recorder = useRecorder({
    activeSessionId,
    onSessionCreated: selectActiveSession,
  });
  const visibleDeviceState = projectRecorderScene(
    deviceState,
    recorder.recording.status,
  );
  const revealState = getRevealState(visibleDeviceState);
  const surfaceIdentity: RuntimeSurfaceIdentity = {
    activeSessionId,
    pendingSessionId: recorder.pendingSessionId,
    attemptId: eventsState.attemptId,
    sequence: eventsState.lastSequence,
    revealState,
  };
  const sessionIdentityState = getSessionIdentityState(surfaceIdentity);

  // Kiosk/device mode: the bare 320x480 screen, no enclosure chrome.
  if (mode === "device") {
    return (
      <main
        className="viewport-shell"
        data-mode="device"
        data-device-state={visibleDeviceState.phase}
        data-canonical-device-state={deviceState.phase}
        data-active-session-id={activeSessionId ?? ""}
        data-pending-session-id={recorder.pendingSessionId ?? ""}
        data-visible-session-id={recorder.pendingSessionId ?? activeSessionId ?? ""}
        data-session-identity-state={sessionIdentityState}
        data-attempt-id={eventsState.attemptId ?? ""}
        data-sequence={eventsState.lastSequence}
        data-reveal-state={revealState}
        aria-label="MPI3508 device canvas"
      >
        <DeviceScreen
          browserRecordingAvailable={browserRecordingAvailable}
          deviceState={visibleDeviceState}
          manualBusy={manualBusy}
          recorder={recorder}
          surfaceIdentity={surfaceIdentity}
        />
      </main>
    );
  }

  // Preview mode: the bare hardware screen sits beside the operator console.
  return (
    <main
      className="viewport-shell"
      data-mode="preview"
      data-device-state={visibleDeviceState.phase}
      data-canonical-device-state={deviceState.phase}
      data-active-session-id={activeSessionId ?? ""}
      data-pending-session-id={recorder.pendingSessionId ?? ""}
      data-visible-session-id={recorder.pendingSessionId ?? activeSessionId ?? ""}
      data-session-identity-state={sessionIdentityState}
      data-attempt-id={eventsState.attemptId ?? ""}
      data-sequence={eventsState.lastSequence}
      data-reveal-state={revealState}
      aria-label="jiko desktop preview"
    >
      <header className="preview-topbar">
        <div className="brandmark">
          <span className="brand-name">jiko</span>
          <span className="brand-desc">信号仪 · 桌面预览</span>
        </div>
        <span className="phase-tag" data-device-state={visibleDeviceState.phase}>
          {PHASE_TAGS[visibleDeviceState.phase]}
        </span>
      </header>

      <div className="preview-body">
        <section className="preview-demo-pane" aria-label="demo.html bare device UI">
          <DeviceScreen
            browserRecordingAvailable={browserRecordingAvailable}
            deviceState={visibleDeviceState}
            manualBusy={manualBusy}
            recorder={recorder}
            surfaceIdentity={surfaceIdentity}
          />
        </section>

        <PreviewTools
          recorder={recorder}
          phase={visibleDeviceState.phase}
          recentEvents={eventsState.recentEvents}
          attemptId={eventsState.attemptId}
          lastSequence={eventsState.lastSequence}
          onManualBusyChange={setManualBusy}
        />
      </div>
    </main>
  );
}

function DeviceScreen({
  browserRecordingAvailable,
  deviceState,
  manualBusy,
  recorder,
  surfaceIdentity,
}: {
  browserRecordingAvailable: boolean;
  deviceState: DeviceState;
  manualBusy: boolean;
  recorder: ReturnType<typeof useRecorder>;
  surfaceIdentity: RuntimeSurfaceIdentity;
}) {
  const animation = PHASE_ANIMATIONS[deviceState.phase];
  const recorderStatus = deviceRecorderStatus(
    recorder.recording.status,
    deviceState.phase,
    recorder.recording.error,
    recorder.recording.errorCategory,
  );

  return (
    <section
      className="device-canvas"
      data-active-session-id={surfaceIdentity.activeSessionId ?? ""}
      data-pending-session-id={surfaceIdentity.pendingSessionId ?? ""}
      data-visible-session-id={surfaceIdentity.pendingSessionId ?? surfaceIdentity.activeSessionId ?? ""}
      data-session-identity-state={getSessionIdentityState(surfaceIdentity)}
      data-attempt-id={surfaceIdentity.attemptId ?? ""}
      data-sequence={surfaceIdentity.sequence}
      data-reveal-state={surfaceIdentity.revealState}
      aria-label="320 by 480 device canvas"
    >
      <span
        aria-atomic="true"
        aria-live="polite"
        role="status"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: "hidden",
          clipPath: "inset(50%)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        {recorder.recording.status === "error" && recorder.recording.error
          ? `录音错误：${recorder.recording.error}`
          : surfaceIdentity.revealState === "ready"
            ? `结果已就绪：${deviceState.topTitle}`
            : ""}
      </span>
      <div className="panel-layer" />
      <div className="glass-layer" aria-hidden="true" />
      <div className="screen-layer">
        <div
          className="top-strip"
          style={{
            left: px(STABLE_LAYOUT.topStrip.x),
            top: px(STABLE_LAYOUT.topStrip.y),
            width: px(STABLE_LAYOUT.topStrip.w),
            height: px(STABLE_LAYOUT.topStrip.h),
          }}
        >
          <div className="status-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          {recorderStatus ? (
            <div className="top-title-block">
              <span className="top-title">{recorderStatus.title}</span>
              <span className="top-subtitle">{recorderStatus.subtitle}</span>
            </div>
          ) : deviceState.phase === "idle" ? (
            <IdleClock />
          ) : (
            <div className="top-title-block">
              <span className="top-title">{deviceState.topTitle}</span>
              <span className="top-subtitle">{deviceState.topSubtitle}</span>
            </div>
          )}
        </div>

        {STABLE_LAYOUT.windows.map((window) => {
          const lamp = toneForChannel(deviceState.lamps, window.channel);
          const motion = deviceState.lampMotions[window.channel];
          return (
            <div
              className={`reading-window tone-${lamp}`}
              data-lamp-motion={motion}
              key={window.character}
              style={{
                left: px(window.x),
                top: px(window.y),
                width: px(window.w),
                height: px(window.h),
              }}
            >
              <div className="sprite-screen">
                <SpriteMatrix
                  name={window.character as SpriteName}
                  tone={spriteToneFor(lamp)}
                  animation={
                    motion === "locked"
                      ? "locked"
                      : motion === "spinning"
                        ? "reading"
                        : animation
                  }
                  playing={motion !== "locked"}
                  cell={8}
                  gap={2}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mask-layer" aria-hidden="true" />
      {browserRecordingAvailable ? (
        <button
          aria-label={recorder.recording.status === "recording" ? "停止录音" : "开始录音"}
          className="device-record-control"
          data-recording-state={recorder.recording.status}
          disabled={
            manualBusy ||
            recorder.recording.status === "connecting" ||
            recorder.recording.status === "authorizing" ||
            recorder.recording.status === "stopping" ||
            recorder.recording.status === "uploading"
          }
          onClick={recorder.toggleRecording}
          type="button"
        >
          <span className="device-record-dot" />
        </button>
      ) : (
        <div
          aria-label="浏览器录音不可用，请使用硬件输入"
          className="device-input-observer"
          role="status"
        >
          <span>INPUT</span>
          <strong>HW</strong>
        </div>
      )}
    </section>
  );
}

type RevealState = "not-ready" | "revealing" | "ready";

type RuntimeSurfaceIdentity = {
  activeSessionId?: string;
  pendingSessionId?: string;
  attemptId?: string;
  sequence: number;
  revealState: RevealState;
};

function getSessionIdentityState(
  identity: Pick<RuntimeSurfaceIdentity, "activeSessionId" | "pendingSessionId">,
): "idle" | "pending" | "bound" {
  if (identity.pendingSessionId) {
    return "pending";
  }
  return identity.activeSessionId ? "bound" : "idle";
}

function getRevealState(deviceState: DeviceState): RevealState {
  if (deviceState.phase !== "result") {
    return "not-ready";
  }

  return Object.values(deviceState.lampMotions).every((motion) => motion === "locked")
    ? "ready"
    : "revealing";
}

function projectRecorderScene(
  canonicalScene: DeviceState,
  status: ReturnType<typeof useRecorder>["recording"]["status"],
): DeviceState {
  if (status === "authorizing" || status === "recording") {
    return {
      phase: "recording",
      topTitle: "REC",
      topSubtitle: "LOCAL CAPTURE",
      lamps: { text: "amber", voice: "amber", timing: "amber" },
      lampMotions: { text: "resting", voice: "resting", timing: "resting" },
    };
  }

  if (status === "connecting" || status === "stopping" || status === "uploading") {
    return {
      phase: "processing",
      topTitle: "READING",
      topSubtitle: "LOCAL PIPELINE",
      lamps: { text: "dim", voice: "dim", timing: "dim" },
      lampMotions: { text: "spinning", voice: "spinning", timing: "spinning" },
    };
  }

  if (status === "error") {
    return {
      phase: "error",
      topTitle: "ERROR",
      topSubtitle: "CHECK CONTROL",
      lamps: { text: "amber", voice: "amber", timing: "amber" },
      lampMotions: { text: "resting", voice: "resting", timing: "resting" },
    };
  }

  return canonicalScene;
}

function deviceRecorderStatus(
  status: ReturnType<typeof useRecorder>["recording"]["status"],
  phase: DeviceState["phase"],
  error?: string,
  errorCategory?: ReturnType<typeof useRecorder>["recording"]["errorCategory"],
) {
  if (status === "connecting") {
    return { title: "连接后端", subtitle: "LOCAL SERVER" };
  }
  if (status === "authorizing") {
    return { title: "请允许麦克风", subtitle: "MIC PERMISSION" };
  }
  if (status === "recording") {
    return { title: "正在聆听", subtitle: "LOCAL CAPTURE" };
  }
  if (status === "stopping") {
    return { title: "正在封存", subtitle: "LOCAL SEAL" };
  }
  if (status === "uploading") {
    if (phase === "result") return undefined;
    return { title: "正在分析", subtitle: "LOCAL PIPELINE" };
  }
  if (status === "error") {
    return deviceRecorderErrorStatus(error, errorCategory);
  }
  return undefined;
}

function deviceRecorderErrorStatus(
  error?: string,
  errorCategory?: ReturnType<typeof useRecorder>["recording"]["errorCategory"],
) {
  if (errorCategory === "unsupported") {
    return { title: "浏览器不支持", subtitle: "SECURE BROWSER" };
  }
  if (errorCategory === "unconfirmed") {
    return { title: "状态待确认", subtitle: "CHECK LOCAL RESULT" };
  }
  const message = (error ?? "")
    .replace(/^PCM 传输或分析失败：/i, "")
    .replace(/^PCM 采集已停止：/i, "")
    .replace(/^录音上传或分析失败：/i, "")
    .toLowerCase();
  if (
    message.includes("permission") ||
    message.includes("notallowed") ||
    message.includes("权限") ||
    message.includes("拒绝") ||
    message.includes("授权") ||
    message.includes("未授权") ||
    message.includes("不允许")
  ) {
    return { title: "麦克风未授权", subtitle: "MIC PERMISSION" };
  }
  if (
    message.includes("microphone") ||
    message.includes("麦克风") ||
    message.includes("input track") ||
    message.includes("audio context") ||
    message.includes("worklet") ||
    message.includes("设备占用")
  ) {
    return { title: "麦克风中断", subtitle: "MIC INPUT" };
  }
  if (
    message.includes("backend") ||
    message.includes("localhost") ||
    message.includes("后端") ||
    message.includes("会话") ||
    message.includes("连接")
  ) {
    return { title: "后端未连接", subtitle: "LOCAL SERVER" };
  }
  if (
    message.includes("websocket") ||
    message.includes("pcm") ||
    message.includes("acknowledg") ||
    message.includes("传输") ||
    message.includes("最终确认")
  ) {
    return { title: "传输已中断", subtitle: "PCM LINK" };
  }
  if (
    message.includes("analysis") ||
    message.includes("pipeline") ||
    message.includes("分析") ||
    message.includes("finaliz")
  ) {
    return { title: "分析未完成", subtitle: "LOCAL PIPELINE" };
  }
  return { title: "本轮未完成", subtitle: "PRESS TO RETRY" };
}

function toneForChannel(
  lamps: Record<ReadingChannel, LampTone>,
  channel: ReadingChannel,
) {
  return lamps[channel];
}

// Lamp tones (red/amber/green) map to sprite palettes; amber is the canonical
// orange "yellow" palette.
function spriteToneFor(lamp: LampTone): SpriteTone {
  if (lamp === "amber" || lamp === "dim") return "yellow";
  return lamp;
}
