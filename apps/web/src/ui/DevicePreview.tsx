import { useDeviceEvents, type LampTone, type ReadingChannel } from "../events/useDeviceEvents";
import { PreviewTools } from "./PreviewTools";

const STABLE_LAYOUT = {
  topStrip: { x: 34, y: 24, w: 252, h: 58 },
  windows: [
    { x: 42, y: 98, w: 236, h: 104, label: "TEXT", channel: "text" },
    { x: 42, y: 218, w: 236, h: 104, label: "VOICE", channel: "voice" },
    { x: 42, y: 338, w: 236, h: 104, label: "PACE", channel: "timing" },
  ],
  lensDiameter: 98,
} as const;

const DOTS = [
  [0, 0],
  [1, 0],
  [2, 0],
  [0, 1],
  [2, 1],
  [0, 2],
  [1, 2],
  [2, 2],
  [0, 3],
  [2, 3],
  [0, 4],
  [2, 4],
  [0, 5],
  [1, 5],
  [2, 5],
];

function px(value: number) {
  return `${value}px`;
}

export function DevicePreview() {
  const searchParams = new URLSearchParams(window.location.search);
  const mode = searchParams.get("mode") === "device" ? "device" : "preview";
  const eventsState = useDeviceEvents();
  const deviceState = eventsState.device;

  return (
    <main
      className="viewport-shell"
      data-mode={mode}
      data-device-state={deviceState.phase}
      aria-label="MPI3508 device preview"
    >
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
            <div className="top-title-block">
              <span className="top-title">{deviceState.topTitle}</span>
              <span className="top-subtitle">{deviceState.topSubtitle}</span>
            </div>
          </div>

          {STABLE_LAYOUT.windows.map((window, index) => (
            <div
              className={`reading-window tone-${toneForChannel(
                deviceState.lamps,
                window.channel,
              )}`}
              key={window.label}
              style={{
                left: px(window.x),
                top: px(window.y),
                width: px(window.w),
                height: px(window.h),
              }}
            >
              <div className="window-bezel">
                <div
                  className={`lens lens-${index + 1}`}
                  style={{
                    width: px(STABLE_LAYOUT.lensDiameter),
                    height: px(STABLE_LAYOUT.lensDiameter),
                  }}
                >
                  <PixelMark label={window.label} />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="mask-layer" aria-hidden="true" />
      </section>
      {mode === "preview" ? (
        <PreviewTools
          currentSessionId={eventsState.sessionId}
          phase={deviceState.phase}
          recentEvents={eventsState.recentEvents}
        />
      ) : null}
    </main>
  );
}

function toneForChannel(
  lamps: Record<ReadingChannel, LampTone>,
  channel: ReadingChannel,
) {
  return lamps[channel];
}

function PixelMark({ label }: { label: string }) {
  return (
    <div className="pixel-mark" aria-label={label}>
      <div className="pixel-grid" aria-hidden="true">
        {DOTS.map(([x, y], index) => (
          <span
            key={`${x}-${y}-${index}`}
            style={{
              gridColumn: x + 2,
              gridRow: y + 2,
            }}
          />
        ))}
      </div>
      <span>{label}</span>
    </div>
  );
}
