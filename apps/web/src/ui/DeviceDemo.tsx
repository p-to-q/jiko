import { IdleClock } from "./IdleClock";
import { SpriteMatrix, type SpriteName } from "./sprites";

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

function px(value: number) {
  return `${value}px`;
}

function resolvePart(): DemoPart {
  const value = new URLSearchParams(window.location.search).get("only");
  return (PARTS as readonly string[]).includes(value ?? "")
    ? (value as DemoPart)
    : "all";
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

// playing={false} freezes the idle sequence on frame 0 (king "original", tree
// "original", oracle "closed") — the rest pose, so captures are deterministic.
function LedSquare({ character }: { character: SpriteName }) {
  return (
    <SpriteMatrix
      name={character}
      tone="yellow"
      animation="idle"
      playing={false}
      cell={8}
      gap={2}
    />
  );
}

// Right-edge rocker key: a long thin lever that widens to a lens around a central
// pivot screw — the side button from the hardware reference.
function SideKey() {
  return (
    <div className="demo-side-key" aria-hidden="true">
      <span className="key-bar" />
      <span className="key-bulge" />
      <span className="key-pivot" />
    </div>
  );
}

export function DeviceDemo() {
  const part = resolvePart();

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
            <div className="demo-led">
              <LedSquare character={part} />
            </div>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="demo-stage" data-only="all">
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

          {LAYOUT.windows.map((window) => (
            <div
              className="demo-led"
              key={window.character}
              style={{
                position: "absolute",
                left: px(SQUARE_X),
                top: px(window.y),
                width: px(SQUARE),
                height: px(SQUARE),
              }}
            >
              <LedSquare character={window.character as SpriteName} />
            </div>
          ))}
        </div>

        {/* Optional cover glass — kept very faint; raise --cover to taste. */}
        <div className="demo-cover" aria-hidden="true" />
        <SideKey />
      </section>
    </main>
  );
}
