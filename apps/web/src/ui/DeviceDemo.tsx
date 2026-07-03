import { useEffect, useState } from "react";
import { IdleClock } from "./IdleClock";
import type { RecorderControls } from "../events/useRecorder";
import logoUrl from "../assets/cdsvds.svg";
import {
  SpriteMatrix,
  type SpriteAnimation,
  type SpriteName,
  type SpriteTone,
} from "./sprites";

// Bare-hardware idle face: the body is black (it sinks into the page), each reading
// window is just a plain square LED module with no effects, and a physical rocker
// key sits on the right edge. ?only=<part> isolates one module for capture.
const SQUARE = 108;
const CANVAS_W = 320;
const SQUARE_X = (CANVAS_W - SQUARE) / 2;

const LAYOUT = {
  topStrip: { x: 34, y: 24, w: 252, h: 76 },
  windows: [
    { y: 113, character: "king" },
    { y: 231, character: "tree" },
    { y: 349, character: "oracle" },
  ],
} as const;

// ?only=<part> lifts a single module out onto a bare stage for per-box capture.
const PARTS = ["all", "clock", "king", "tree", "oracle"] as const;
type DemoPart = (typeof PARTS)[number];
const DANCE_TONES: SpriteTone[] = ["yellow", "red", "green"];
const DANCE_FRAME_INTERVAL_MS = 650;
const DANCE_FRAME_COUNT = 6;

function px(value: number) {
  return `${value}px`;
}

function resolvePart(): DemoPart {
  const value = new URLSearchParams(window.location.search).get("only");
  return (PARTS as readonly string[]).includes(value ?? "")
    ? (value as DemoPart)
    : "all";
}

function resolveDemoMode() {
  return new URLSearchParams(window.location.search).get("demo") === "dance"
    ? "dance"
    : "idle";
}

function StatusDots() {
  return (
    <div className="status-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

function DemoLogo() {
  return (
    <div className="demo-logo-panel" aria-hidden="true">
      <img className="demo-logo-mark" src={logoUrl} alt="jiko logo" />
    </div>
  );
}

// playing={false} freezes the idle sequence on frame 0 (king "original", tree
// "original", oracle "closed") — the rest pose, so captures are deterministic.
function useDanceCycle(enabled: boolean) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setStep(0);
      return;
    }

    const id = window.setInterval(
      () => setStep((value) => (value + 1) % (DANCE_FRAME_COUNT * DANCE_TONES.length)),
      DANCE_FRAME_INTERVAL_MS,
    );

    return () => window.clearInterval(id);
  }, [enabled]);

  return {
    frameIndex: step % DANCE_FRAME_COUNT,
    tone: DANCE_TONES[Math.floor(step / DANCE_FRAME_COUNT) % DANCE_TONES.length],
  };
}

function LedSquare({
  character,
  tone = "yellow",
  animation = "idle",
  playing = false,
  frameIndex,
}: {
  character: SpriteName;
  tone?: SpriteTone;
  animation?: SpriteAnimation;
  playing?: boolean;
  frameIndex?: number;
}) {
  return (
    <SpriteMatrix
      name={character}
      tone={tone}
      animation={animation}
      playing={playing}
      frameIndexOverride={frameIndex}
      cell={8}
      gap={2}
    />
  );
}

// Right-edge rocker key: a long thin lever that widens to a lens around a central
// pivot screw — the side button from the hardware reference.
function SideKey({ recorder }: { recorder?: RecorderControls }) {
  const content = (
    <>
      <span className="key-bar" />
      <span className="key-bulge" />
      <span className="key-pivot" />
    </>
  );

  if (!recorder) {
    return (
      <div className="demo-side-key" aria-hidden="true">
        {content}
      </div>
    );
  }

  return (
    <button
      className="demo-side-key"
      type="button"
      aria-label="录音"
      {...recorder.pointerHandlers}
    >
      {content}
    </button>
  );
}

export function DeviceDemo({
  embedded = false,
  demoMode,
  showLogo = !embedded,
  recorder,
}: {
  embedded?: boolean;
  demoMode?: "idle" | "dance";
  showLogo?: boolean;
  recorder?: RecorderControls;
}) {
  const part = embedded ? "all" : resolvePart();
  const resolvedDemoMode = demoMode ?? resolveDemoMode();
  const dancing = resolvedDemoMode === "dance";
  const danceCycle = useDanceCycle(dancing);

  if (part !== "all") {
    return (
      <main className="demo-stage" data-only={part}>
        <div className="demo-isolate">
          {part === "clock" ? (
            <div className="top-strip demo-strip">
              <StatusDots />
              <IdleClock />
            </div>
          ) : (
            <div className="demo-led" data-demo-mode={resolvedDemoMode}>
              <LedSquare
                character={part}
                tone={danceCycle.tone}
                animation={dancing ? "listening" : "idle"}
                playing={dancing}
                frameIndex={dancing ? danceCycle.frameIndex : undefined}
              />
            </div>
          )}
        </div>
      </main>
    );
  }

  return (
    <main
      className="demo-stage"
      data-demo-mode={resolvedDemoMode}
      data-embedded={embedded ? "true" : undefined}
      data-only="all"
    >
      <div className="demo-presentation">
        <section className="device-canvas" aria-label="jiko idle face">
          <div className="screen-layer">
            <div
              className="top-strip"
              style={{
                left: px(LAYOUT.topStrip.x),
                top: px(LAYOUT.topStrip.y),
                width: px(LAYOUT.topStrip.w),
                height: px(LAYOUT.topStrip.h),
              }}
            >
              <StatusDots />
              <IdleClock />
            </div>

            {LAYOUT.windows.map((window, index) => (
              <div
                className={["demo-led", dancing ? `is-dancing dance-${index + 1}` : ""]
                  .filter(Boolean)
                .join(" ")}
                data-demo-mode={resolvedDemoMode}
                key={window.character}
                style={{
                  position: "absolute",
                  left: px(SQUARE_X),
                  top: px(window.y),
                  width: px(SQUARE),
                  height: px(SQUARE),
                }}
              >
                <LedSquare
                  character={window.character as SpriteName}
                  tone={
                    DANCE_TONES[
                      (DANCE_TONES.indexOf(danceCycle.tone) + index) % DANCE_TONES.length
                    ]
                  }
                  animation={dancing ? "listening" : "idle"}
                  playing={dancing}
                  frameIndex={dancing ? danceCycle.frameIndex : undefined}
                />
              </div>
            ))}
          </div>

          {/* Optional cover glass — kept very faint; raise --cover to taste. */}
          <div className="demo-cover" aria-hidden="true" />
          {dancing ? null : <SideKey recorder={recorder} />}
        </section>
        {dancing && showLogo ? <DemoLogo /> : null}
      </div>
    </main>
  );
}
