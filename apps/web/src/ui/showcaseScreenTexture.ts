import * as THREE from "three";
import { glyphFor } from "./dotMatrixFont";
import {
  animations,
  frames,
  palettes,
  type SpriteName,
  type SpriteTone,
} from "./sprites";
import { squircleRectPoints } from "./squircleGeometry";

const CANVAS_W = 320;
const CANVAS_H = 480;
const TEXTURE_SCALE = 3;
const SCREEN_CORNER_RADIUS = 29;
const SCREEN_CORNER_EXPONENT = 3.5;
const SQUARE = 108;
const SQUARE_X = (CANVAS_W - SQUARE) / 2;
const DANCE_TONES: SpriteTone[] = ["yellow", "red", "green"];
const DANCE_FRAME_INTERVAL_MS = 650;
const DANCE_FRAME_COUNT = 6;
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

const LAYOUT = {
  topStrip: { x: 34, y: 24, w: 252, h: 76 },
  windows: [
    { y: 113, character: "king" },
    { y: 231, character: "tree" },
    { y: 349, character: "oracle" },
  ],
} as const;

export type ShowcaseScreenTexture = {
  texture: THREE.CanvasTexture;
  update(time: number): void;
  dispose(): void;
};

export function createShowcaseScreenTexture(): ShowcaseScreenTexture {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W * TEXTURE_SCALE;
  canvas.height = CANVAS_H * TEXTURE_SCALE;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D context is unavailable for showcase screen texture.");
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 8;

  const clockStart = resolveClockStart();
  let lastFrame = -1;

  const update = (time: number) => {
    const frame = Math.floor(time / 100);
    if (frame === lastFrame) {
      return;
    }

    lastFrame = frame;
    drawDeviceScreen(context, time, clockStart);
    texture.needsUpdate = true;
  };

  update(0);

  return {
    texture,
    update,
    dispose() {
      texture.dispose();
    },
  };
}

function drawDeviceScreen(
  context: CanvasRenderingContext2D,
  time: number,
  clockStart: Date | undefined,
) {
  context.setTransform(TEXTURE_SCALE, 0, 0, TEXTURE_SCALE, 0, 0);
  context.clearRect(0, 0, CANVAS_W, CANVAS_H);
  context.save();
  squircleRectPath(
    context,
    0,
    0,
    CANVAS_W,
    CANVAS_H,
    SCREEN_CORNER_RADIUS,
    SCREEN_CORNER_EXPONENT,
    SCREEN_CORNER_EXPONENT,
  );
  context.clip();

  drawPanel(context);
  drawTopStrip(context, time, clockStart);

  const danceStep = Math.floor(time / DANCE_FRAME_INTERVAL_MS) %
    (DANCE_FRAME_COUNT * DANCE_TONES.length);
  const frameIndex = danceStep % DANCE_FRAME_COUNT;
  const tone = DANCE_TONES[Math.floor(danceStep / DANCE_FRAME_COUNT) % DANCE_TONES.length];

  LAYOUT.windows.forEach((window, index) => {
    const resolvedTone = DANCE_TONES[(DANCE_TONES.indexOf(tone) + index) % DANCE_TONES.length];
    drawLedSquare(
      context,
      SQUARE_X,
      window.y,
      window.character,
      resolvedTone,
      frameIndex,
    );
  });

  drawCoverGlass(context);
  context.restore();
}

function drawPanel(context: CanvasRenderingContext2D) {
  context.fillStyle = "#020202";
  squircleRectPath(
    context,
    0,
    0,
    CANVAS_W,
    CANVAS_H,
    SCREEN_CORNER_RADIUS,
    SCREEN_CORNER_EXPONENT,
    SCREEN_CORNER_EXPONENT,
  );
  context.fill();

  const top = context.createRadialGradient(160, -42, 0, 160, -42, 142);
  top.addColorStop(0, "rgba(255, 214, 150, 0.08)");
  top.addColorStop(0.48, "rgba(255, 214, 150, 0.022)");
  top.addColorStop(1, "rgba(255, 214, 150, 0)");
  context.fillStyle = top;
  context.fillRect(0, 0, CANVAS_W, 96);

  const bottom = context.createRadialGradient(160, CANVAS_H + 30, 0, 160, CANVAS_H + 30, 230);
  bottom.addColorStop(0, "rgba(255, 255, 255, 0.04)");
  bottom.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = bottom;
  context.fillRect(0, CANVAS_H - 150, CANVAS_W, 150);
}

function drawTopStrip(
  context: CanvasRenderingContext2D,
  time: number,
  clockStart: Date | undefined,
) {
  const strip = LAYOUT.topStrip;
  const now = clockStart ? new Date(clockStart.getTime() + time) : new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const weekday = WEEKDAYS[now.getDay()];
  const date = `${MONTHS[now.getMonth()]} ${now.getDate()}`;
  const colonVisible = Math.floor(time / 1000) % 2 === 0;
  const metaRight = strip.x + strip.w - 2;
  const metaOptions = {
    dot: 2,
    gap: 0,
    tracking: 3,
    color: "#f09035",
    glow: "rgba(240, 144, 53, 0.55)",
  };

  drawStatusDots(context, strip.x + 7, strip.y + 24);
  drawDotText(context, `${hours}${colonVisible ? ":" : " "}${minutes}`, strip.x + 35, strip.y + 16, {
    dot: 5,
    gap: 1,
    tracking: 6,
    color: "#f6ead0",
    glow: "rgba(246, 234, 208, 0.62)",
  });
  drawDotText(
    context,
    weekday,
    metaRight - measureDotTextWidth(weekday, metaOptions),
    strip.y + 12,
    metaOptions,
  );
  drawDotText(
    context,
    date,
    metaRight - measureDotTextWidth(date, metaOptions),
    strip.y + 34,
    { ...metaOptions, glow: "rgba(240, 144, 53, 0.5)" },
  );
  drawBattery(context, metaRight - 21, strip.y + 56);
}

function drawStatusDots(context: CanvasRenderingContext2D, x: number, y: number) {
  context.save();
  context.fillStyle = "#f09035";
  context.shadowColor = "rgba(240, 144, 53, 0.88)";
  context.shadowBlur = 7;
  [0, 12, 24].forEach((offset) => {
    drawCircle(context, x, y + offset, 2.5);
  });
  context.restore();
}

function drawBattery(context: CanvasRenderingContext2D, x: number, y: number) {
  context.save();
  context.strokeStyle = "#f09035";
  context.fillStyle = "#f09035";
  context.lineWidth = 1;
  context.shadowColor = "rgba(240, 144, 53, 0.5)";
  context.shadowBlur = 4;
  roundedRectPath(context, x, y, 18, 10, 2);
  context.stroke();
  context.fillRect(x + 3, y + 3, 3, 4);
  context.fillRect(x + 8, y + 3, 3, 4);
  context.fillRect(x + 13, y + 3, 3, 4);
  roundedRectPath(context, x + 19, y + 3, 2, 4, 1);
  context.fill();
  context.restore();
}

function drawLedSquare(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  character: SpriteName,
  tone: SpriteTone,
  frameIndex: number,
) {
  const palette = palettes[tone];

  context.save();
  context.fillStyle = palette.screen;
  context.shadowColor = "rgba(0, 0, 0, 0.46)";
  context.shadowBlur = 18;
  roundedRectPath(context, x, y, SQUARE, SQUARE, 3);
  context.fill();

  const shine = context.createRadialGradient(x + 52, y + 18, 0, x + 52, y + 18, 76);
  shine.addColorStop(0, "rgba(255, 255, 255, 0.04)");
  shine.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = shine;
  roundedRectPath(context, x, y, SQUARE, SQUARE, 3);
  context.fill();

  context.strokeStyle = "#2f3033";
  context.lineWidth = 1;
  roundedRectPath(context, x + 0.5, y + 0.5, SQUARE - 1, SQUARE - 1, 3);
  context.stroke();

  const rows = resolveSpriteRows(character, frameIndex);
  const cell = 8;
  const gap = 2;
  const dot = cell;
  const step = cell + gap;
  const matrixW = rows[0].length * cell + (rows[0].length - 1) * gap;
  const matrixX = x + (SQUARE - matrixW) / 2;
  const matrixY = y + (SQUARE - matrixW) / 2;

  rows.forEach((row, rowIndex) => {
    [...row].forEach((value, colIndex) => {
      const cx = matrixX + colIndex * step + dot / 2;
      const cy = matrixY + rowIndex * step + dot / 2;

      if (value === ".") {
        context.fillStyle = palette.dim;
        context.globalAlpha = 0.5;
        drawCircle(context, cx, cy, dot / 2);
        context.globalAlpha = 1;
        return;
      }

      const color = value === "2" ? palette.secondary : palette.primary;
      context.fillStyle = color;
      context.shadowColor = value === "2" ? palette.secondary : palette.halo;
      context.shadowBlur = value === "2" ? dot * 1.2 : dot * 1.5;
      drawCircle(context, cx, cy, dot / 2);
      context.shadowBlur = 0;
    });
  });
  context.restore();
}

function resolveSpriteRows(name: SpriteName, frameIndex: number): readonly string[] {
  const sequence = animations.listening.characters[name];
  const frameName = sequence[frameIndex % sequence.length];
  const table = frames[name] as Record<string, readonly string[]>;
  return table[frameName] ?? Object.values(table)[0];
}

function drawCoverGlass(context: CanvasRenderingContext2D) {
  context.save();
  context.globalCompositeOperation = "screen";

  const upper = context.createRadialGradient(160, -34, 0, 160, -34, 118);
  upper.addColorStop(0, "rgba(255, 218, 158, 0.07)");
  upper.addColorStop(0.64, "rgba(255, 218, 158, 0.012)");
  upper.addColorStop(1, "rgba(255, 218, 158, 0)");
  context.fillStyle = upper;
  context.fillRect(0, 0, CANVAS_W, 74);

  const side = context.createLinearGradient(0, 0, CANVAS_W, 0);
  side.addColorStop(0, "rgba(255, 222, 170, 0.032)");
  side.addColorStop(0.2, "rgba(255, 222, 170, 0)");
  side.addColorStop(0.78, "rgba(255, 255, 255, 0)");
  side.addColorStop(1, "rgba(255, 255, 255, 0.012)");
  context.fillStyle = side;
  context.fillRect(0, 0, CANVAS_W, CANVAS_H);

  context.restore();
}

function drawDotText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  options: { dot: number; gap: number; tracking: number; color: string; glow: string },
) {
  let cursor = x;

  context.save();
  context.fillStyle = options.color;
  context.shadowColor = options.glow;
  context.shadowBlur = options.dot * 1.05;

  [...text].forEach((char) => {
    const glyph = glyphFor(char);
    glyph.forEach((row, rowIndex) => {
      [...row].forEach((value, colIndex) => {
        if (value !== "1") {
          return;
        }

        drawCircle(
          context,
          cursor + colIndex * (options.dot + options.gap) + options.dot / 2,
          y + rowIndex * (options.dot + options.gap) + options.dot / 2,
          options.dot / 2,
        );
      });
    });

    cursor += glyph[0].length * options.dot + (glyph[0].length - 1) * options.gap +
      options.tracking;
  });

  context.restore();
}

function measureDotTextWidth(
  text: string,
  options: { dot: number; gap: number; tracking: number },
) {
  return [...text].reduce((width, char, index) => {
    const glyph = glyphFor(char);
    const glyphWidth = glyph[0].length * options.dot + (glyph[0].length - 1) * options.gap;
    return width + glyphWidth + (index === text.length - 1 ? 0 : options.tracking);
  }, 0);
}

function roundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function squircleRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  exponentX: number,
  exponentY: number,
) {
  const points = squircleRectPoints({
    x,
    y,
    width,
    height,
    radius,
    exponentX,
    exponentY,
  });

  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => {
    context.lineTo(point.x, point.y);
  });
  context.closePath();
}

function drawCircle(context: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
}

function resolveClockStart(): Date | undefined {
  const value = new URLSearchParams(window.location.search).get("clockStart");
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
