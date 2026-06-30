import {
  useDeviceEvents,
  type DeviceState,
  type LampTone,
  type ReadingChannel,
} from "../events/useDeviceEvents";
import { useRecorder } from "../events/useRecorder";
import { DeviceDemo } from "./DeviceDemo";
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
  const eventsState = useDeviceEvents();
  const deviceState = eventsState.device;
  const recorder = useRecorder(eventsState.sessionId);

  // Kiosk/device mode: the bare 320x480 screen, no enclosure chrome.
  if (mode === "device") {
    return (
      <main
        className="viewport-shell"
        data-mode="device"
        data-device-state={deviceState.phase}
        aria-label="MPI3508 device canvas"
      >
        <DeviceScreen deviceState={deviceState} />
      </main>
    );
  }

  // Preview mode: the bare hardware screen sits beside the operator console.
  return (
    <main
      className="viewport-shell"
      data-mode="preview"
      data-device-state={deviceState.phase}
      aria-label="jiko desktop preview"
    >
      <header className="preview-topbar">
        <div className="brandmark">
          <span className="brand-name">jiko</span>
          <span className="brand-desc">信号仪 · 桌面预览</span>
        </div>
        <span className="phase-tag" data-device-state={deviceState.phase}>
          {PHASE_TAGS[deviceState.phase]}
        </span>
      </header>

      <div className="preview-body">
        <section className="preview-demo-pane" aria-label="demo.html bare device UI">
          <DeviceDemo embedded recorder={recorder} />
        </section>

        <PreviewTools
          recorder={recorder}
          phase={deviceState.phase}
          recentEvents={eventsState.recentEvents}
        />
      </div>
    </main>
  );
}

function DeviceScreen({ deviceState }: { deviceState: DeviceState }) {
  const animation = PHASE_ANIMATIONS[deviceState.phase];

  return (
    <section className="device-canvas" aria-label="320 by 480 device canvas">
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
          {deviceState.phase === "idle" ? (
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
          return (
            <div
              className={`reading-window tone-${lamp}`}
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
                  animation={animation}
                  cell={8}
                  gap={2}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mask-layer" aria-hidden="true" />
    </section>
  );
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
