#!/usr/bin/env node
// Export the jiko idle-face artwork as standalone, scalable SVG assets:
//
//   sprite-{king,tree,oracle}.svg  — orange canonical aliases for the three LED
//                                     graphics, at the centered rest frame.
//   sprite-{king,tree,oracle}-{red,green,orange}.svg
//                                  — color variants on their own, lit dots only,
//                                     NO glow / halo / effects, transparent bg.
//   panel-window.svg               — the empty LED board: bezel, recessed screen,
//                                     the dim 9x9 dot field (九宫格), amber glow.
//   window-{king,tree,oracle}.svg  — orange canonical aliases for full lit window.
//   window-{king,tree,oracle}-{red,green,orange}.svg
//                                  — the full lit window color variants (board +
//                                     grid + sprite with glow), matching the live
//                                     device.
//   contact-sheet.svg              — all of the above laid out on one board.
//
// Geometry and colors mirror apps/web/src/ui/sprites/data.ts and styles.css so the
// vectors are pixel-faithful to what the device renders. Run: node scripts/export-svg.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../docs/assets/svg");
mkdirSync(OUT, { recursive: true });

// --- Palettes (mirror apps/web/src/ui/sprites/data.ts) ----------------------
const PALETTES = {
  orange: {
    primary: "#f09035",
    secondary: "#eee6d2",
    dim: "#2a2418",
    halo: "#f09035",
    glass: "#080805",
    screen: "#050403",
  },
  red: {
    primary: "#e0523a",
    secondary: "#ffc2a4",
    dim: "#2a0c09",
    halo: "#ff6a47",
    glass: "#0d0303",
    screen: "#060202",
  },
  green: {
    primary: "#79bf72",
    secondary: "#dceec8",
    dim: "#0d1f13",
    halo: "#8fe882",
    glass: "#041009",
    screen: "#020805",
  },
};
const TONES = ["red", "green", "orange"];
const CANONICAL_TONE = "orange";
const DIM_OPACITY = 0.5;

// --- Rest frames (the non-swaying "centered" pose the screenshot freezes on) -
// king/tree use "original"; oracle's idle rest frame is "closed".
const FRAMES = {
  king: [
    "...111...",
    "..11111..",
    "...1.1...",
    ".1111111.",
    "1.11111.1",
    "..11111..",
    "...111...",
    "..1.1.1..",
    ".1.....1.",
  ],
  tree: [
    "....1....",
    "...111...",
    "..11111..",
    ".1111111.",
    "...111...",
    "..11111..",
    "....1....",
    "....1....",
    "...111...",
  ],
  oracle: [
    "....1....",
    "..11111..",
    ".11...11.",
    "11.....11",
    "111222111",
    "11.....11",
    ".11...11.",
    "..11111..",
    "....1....",
  ],
};
const NAMES = ["king", "tree", "oracle"];

// --- Geometry ---------------------------------------------------------------
// Device truth: 9 cells x 8px dot + 2px gap = 88px field. styles.css renders dots
// as circles of diameter = cell. We keep the 8px dot / 10px pitch so a tight
// sprite is 88x88 and the field lands identically inside the window.
const CELL = 8;
const PITCH = 10;
const R = CELL / 2; // dot radius = 4
const FIELD = 9 * PITCH - (PITCH - CELL); // 88

// Window truth (DevicePreview STABLE_LAYOUT + styles.css):
const WIN = { w: 236, h: 102, r: 22 };
const SCREEN = { x: 43, y: 5, w: 150, h: 92, r: 16 };
// Field is centre-placed in the screen, screen is centre-placed in the window.
const FIELD_X = SCREEN.x + (SCREEN.w - FIELD) / 2; // 74
const FIELD_Y = SCREEN.y + (SCREEN.h - FIELD) / 2; // 7

const f = (n) => Number(n.toFixed(2));
const ids = (tone) => ({
  board: `board-${tone}`,
  screen: `screen-${tone}`,
  ambient: `ambient-${tone}`,
  vignette: `vignette-${tone}`,
  sheen: `sheen-${tone}`,
  screenHalo: `screen-halo-${tone}`,
  ledGlow: `led-glow-${tone}`,
});

// Emit the dots for one frame. ox/oy = top-left of the 88px field in the target
// coordinate space. mode: "lit" (only on-dots), "dim" (only off-dots), "all".
function dots(rows, palette, tone, ox, oy, mode, { glow = false } = {}) {
  const toneIds = ids(tone);
  const lit = [];
  const off = [];
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const cx = f(ox + x * PITCH + R);
      const cy = f(oy + y * PITCH + R);
      if (ch === "1" || ch === "2") {
        const fill = ch === "2" ? palette.secondary : palette.primary;
        lit.push(`<circle cx="${cx}" cy="${cy}" r="${R}" fill="${fill}"/>`);
      } else {
        off.push(
          `<circle cx="${cx}" cy="${cy}" r="${R}" fill="${palette.dim}" opacity="${DIM_OPACITY}"/>`,
        );
      }
    });
  });
  const litGroup = glow
    ? `<g filter="url(#${toneIds.ledGlow})">\n      ${lit.join("\n      ")}\n    </g>`
    : lit.join("\n      ");
  if (mode === "lit") return litGroup;
  if (mode === "dim") return off.join("\n      ");
  return `${off.join("\n      ")}\n      ${litGroup}`;
}

// --- 1) Clean sprite: lit dots only, no glow, transparent -------------------
function cleanSprite(name, tone) {
  const palette = PALETTES[tone];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FIELD} ${FIELD}" width="${FIELD}" height="${FIELD}" role="img" aria-label="jiko ${name} sprite">
  <title>jiko ${name} ${tone}</title>
  <g>
      ${dots(FRAMES[name], palette, tone, 0, 0, "lit")}
  </g>
</svg>
`;
}

// --- Shared <defs> for the board (gradients + glow filter) -------------------
function boardDefs(tone) {
  const palette = PALETTES[tone];
  const toneIds = ids(tone);
  return `  <defs>
    <linearGradient id="${toneIds.board}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#100f0d"/>
      <stop offset="1" stop-color="#060605"/>
    </linearGradient>
    <linearGradient id="${toneIds.screen}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${palette.glass}"/>
      <stop offset="0.62" stop-color="${palette.screen}"/>
      <stop offset="1" stop-color="#020202"/>
    </linearGradient>
    <radialGradient id="${toneIds.ambient}" cx="0.5" cy="0.42" r="0.62">
      <stop offset="0" stop-color="${palette.halo}" stop-opacity="0.16"/>
      <stop offset="0.72" stop-color="${palette.halo}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="${toneIds.vignette}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0.4" stop-color="#000000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.55"/>
    </linearGradient>
    <linearGradient id="${toneIds.sheen}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.07"/>
      <stop offset="0.42" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <filter id="${toneIds.screenHalo}" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="8"/>
    </filter>
    <filter id="${toneIds.ledGlow}" x="-120%" y="-120%" width="340%" height="340%">
      <feGaussianBlur stdDeviation="2.6" result="b"/>
      <feMerge>
        <feMergeNode in="b"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>`;
}

// The board + recessed screen + glow, minus the dot field (added by caller).
function boardBody(tone) {
  const palette = PALETTES[tone];
  const toneIds = ids(tone);
  const { x, y, w, h, r } = SCREEN;
  const stroke = tone === "orange" ? "rgba(244,202,112,0.30)" : palette.halo;
  return `  <!-- board / bezel -->
  <rect x="0.5" y="0.5" width="${WIN.w - 1}" height="${WIN.h - 1}" rx="${WIN.r}" fill="url(#${toneIds.board})" stroke="${stroke}" stroke-width="1"/>
  <rect x="6.5" y="6.5" width="${WIN.w - 13}" height="${WIN.h - 13}" rx="${WIN.r - 5}" fill="url(#${toneIds.ambient})"/>
  <!-- outer screen halo -->
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${palette.halo}" opacity="0.18" filter="url(#${toneIds.screenHalo})"/>
  <!-- recessed screen -->
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="url(#${toneIds.screen})" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="url(#${toneIds.ambient})"/>`;
}

// Overlays drawn above the dot field: glass sheen + bottom-right vignette.
function screenOverlays(tone) {
  const toneIds = ids(tone);
  const { x, y, w, h, r } = SCREEN;
  return `  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="url(#${toneIds.vignette})"/>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="url(#${toneIds.sheen})"/>`;
}

// --- 2) Empty panel: board + dim 9x9 field + glow ---------------------------
function panelWindow() {
  const tone = CANONICAL_TONE;
  const palette = PALETTES[tone];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIN.w} ${WIN.h}" width="${WIN.w}" height="${WIN.h}" role="img" aria-label="jiko LED window (empty)">
  <title>jiko LED window — board, dot grid, glow</title>
${boardDefs(tone)}
${windowMarkup(tone, dots(FRAMES.king, palette, tone, FIELD_X, FIELD_Y, "dim"), "dim dot grid (九宫格)")}
</svg>
`;
}

// --- 3) Full lit window: board + field + sprite with glow -------------------
function litWindow(name, tone) {
  const palette = PALETTES[tone];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIN.w} ${WIN.h}" width="${WIN.w}" height="${WIN.h}" role="img" aria-label="jiko ${name} ${tone} window">
  <title>jiko ${name} ${tone} — lit window</title>
${boardDefs(tone)}
${litWindowMarkup(name, tone, palette)}
</svg>
`;
}

function litWindowMarkup(name, tone, palette = PALETTES[tone]) {
  return windowMarkup(
    tone,
    dots(FRAMES[name], palette, tone, FIELD_X, FIELD_Y, "all", { glow: true }),
    "dot field: dim grid + lit sprite",
  );
}

function windowMarkup(tone, dotMarkup, label) {
  return `${boardBody(tone)}
  <!-- ${label} -->
  <g>
      ${dotMarkup}
  </g>
${screenOverlays(tone)}`;
}

// --- 4) Contact sheet (all assets on one dark board) ------------------------
function contactSheet() {
  const pad = 28;
  const gap = 26;
  const colW = WIN.w;
  const sheetW = pad * 2 + colW;
  const rowH = WIN.h;
  // clean sprites row uses the 88px tiles scaled to sit on the same column
  const spriteRowH = FIELD;
  const sheetH =
    pad * 2 + spriteRowH + gap + rowH + gap + rowH * 3 + gap * 2 + 3 * 22;

  const tiles = [];
  // Row A: three clean sprites side by side
  const triW = (colW - gap * 2) / 3;
  const palette = PALETTES[CANONICAL_TONE];
  NAMES.forEach((name, i) => {
    const sx = pad + i * (triW + gap) + (triW - FIELD) / 2;
    tiles.push(
      `<g transform="translate(${f(sx)} ${pad})">${dots(FRAMES[name], palette, CANONICAL_TONE, 0, 0, "lit")}</g>`,
    );
  });
  // Row B: empty panel
  let cy = pad + spriteRowH + gap;
  tiles.push(
    `<g transform="translate(${pad} ${cy})">${windowMarkup(CANONICAL_TONE, dots(FRAMES.king, palette, CANONICAL_TONE, FIELD_X, FIELD_Y, "dim"), "dim dot grid (九宫格)")}</g>`,
  );
  // Rows C..E: lit windows
  NAMES.forEach((name, i) => {
    const wy = cy + rowH + gap + i * (rowH + gap);
    tiles.push(
      `<g transform="translate(${pad} ${wy})">${litWindowMarkup(name, CANONICAL_TONE, palette)}</g>`,
    );
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sheetW} ${f(sheetH)}" width="${sheetW}" height="${f(sheetH)}" role="img" aria-label="jiko asset contact sheet">
  <rect width="${sheetW}" height="${f(sheetH)}" rx="20" fill="#0a0b0d"/>
${boardDefs(CANONICAL_TONE)}
  ${tiles.join("\n  ")}
</svg>
`;
}

function paletteSheet() {
  const pad = 28;
  const labelH = 18;
  const tileGap = 18;
  const toneGap = 34;
  const colW = WIN.w;
  const sheetW = pad * 2 + NAMES.length * colW + (NAMES.length - 1) * tileGap;
  const rowH = labelH + 10 + WIN.h;
  const sheetH = pad * 2 + TONES.length * rowH + (TONES.length - 1) * toneGap;

  const tiles = [];
  TONES.forEach((tone, toneIndex) => {
    const y = pad + toneIndex * (rowH + toneGap);
    tiles.push(
      `<text x="${pad}" y="${y + 13}" fill="${PALETTES[tone].primary}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13" letter-spacing="2">${tone.toUpperCase()}</text>`,
    );
    NAMES.forEach((name, nameIndex) => {
      const x = pad + nameIndex * (colW + tileGap);
      tiles.push(
        `<g transform="translate(${x} ${y + labelH + 10})">${litWindowMarkup(name, tone)}</g>`,
      );
    });
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sheetW} ${f(sheetH)}" width="${sheetW}" height="${f(sheetH)}" role="img" aria-label="jiko red green orange lamp asset sheet">
  <rect width="${sheetW}" height="${f(sheetH)}" rx="20" fill="#0a0b0d"/>
${TONES.map((tone) => boardDefs(tone)).join("\n")}
  ${tiles.join("\n  ")}
</svg>
`;
}

// --- Write everything -------------------------------------------------------
const files = {};
for (const name of NAMES) {
  files[`sprite-${name}.svg`] = cleanSprite(name, CANONICAL_TONE);
  files[`window-${name}.svg`] = litWindow(name, CANONICAL_TONE);

  for (const tone of TONES) {
    files[`sprite-${name}-${tone}.svg`] = cleanSprite(name, tone);
    files[`window-${name}-${tone}.svg`] = litWindow(name, tone);
  }
}
files["panel-window.svg"] = panelWindow();
files["contact-sheet.svg"] = contactSheet();
files["palette-sheet.svg"] = paletteSheet();

for (const [name, body] of Object.entries(files)) {
  writeFileSync(resolve(OUT, name), body);
  console.log(`  wrote docs/assets/svg/${name}`);
}
console.log("Done.");
