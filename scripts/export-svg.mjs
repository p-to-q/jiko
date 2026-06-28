#!/usr/bin/env node
// Export the jiko idle-face artwork as standalone, scalable SVG assets:
//
//   sprite-{king,tree,oracle}.svg  — the three LED graphics on their own, at the
//                                     centered rest frame, lit dots only, NO glow
//                                     / halo / effects, transparent background.
//   panel-window.svg               — the empty LED board: bezel, recessed screen,
//                                     the dim 9x9 dot field (九宫格), amber glow.
//   window-{king,tree,oracle}.svg  — the full lit window (board + grid + sprite
//                                     with its glow), matching the live device.
//   contact-sheet.svg              — all of the above laid out on one board.
//
// Geometry and colors mirror apps/web/src/ui/sprites/data.ts and styles.css so the
// vectors are pixel-faithful to what the device renders. Run: node scripts/export-svg.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../docs/assets/svg");
mkdirSync(OUT, { recursive: true });

// --- Palette (yellow/amber tone from data.ts) -------------------------------
const PRIMARY = "#f09035"; // lit dot
const SECONDARY = "#eee6d2"; // accent dot (oracle centre)
const DIM = "#2a2418"; // unlit dot
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

// Emit the dots for one frame. ox/oy = top-left of the 88px field in the target
// coordinate space. mode: "lit" (only on-dots), "dim" (only off-dots), "all".
function dots(rows, ox, oy, mode, { glow = false } = {}) {
  const lit = [];
  const off = [];
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const cx = f(ox + x * PITCH + R);
      const cy = f(oy + y * PITCH + R);
      if (ch === "1" || ch === "2") {
        const fill = ch === "2" ? SECONDARY : PRIMARY;
        lit.push(`<circle cx="${cx}" cy="${cy}" r="${R}" fill="${fill}"/>`);
      } else {
        off.push(
          `<circle cx="${cx}" cy="${cy}" r="${R}" fill="${DIM}" opacity="${DIM_OPACITY}"/>`,
        );
      }
    });
  });
  const litGroup = glow
    ? `<g filter="url(#led-glow)">\n      ${lit.join("\n      ")}\n    </g>`
    : lit.join("\n      ");
  if (mode === "lit") return litGroup;
  if (mode === "dim") return off.join("\n      ");
  return `${off.join("\n      ")}\n      ${litGroup}`;
}

// --- 1) Clean sprite: lit dots only, no glow, transparent -------------------
function cleanSprite(name) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FIELD} ${FIELD}" width="${FIELD}" height="${FIELD}" role="img" aria-label="jiko ${name} sprite">
  <title>jiko ${name}</title>
  <g>
      ${dots(FRAMES[name], 0, 0, "lit")}
  </g>
</svg>
`;
}

// --- Shared <defs> for the board (gradients + glow filter) -------------------
function boardDefs() {
  return `  <defs>
    <linearGradient id="board" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#100f0d"/>
      <stop offset="1" stop-color="#060605"/>
    </linearGradient>
    <linearGradient id="screen" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#161412"/>
      <stop offset="0.62" stop-color="#060504"/>
      <stop offset="1" stop-color="#020202"/>
    </linearGradient>
    <radialGradient id="ambient" cx="0.5" cy="0.42" r="0.62">
      <stop offset="0" stop-color="${PRIMARY}" stop-opacity="0.16"/>
      <stop offset="0.72" stop-color="${PRIMARY}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="vignette" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0.4" stop-color="#000000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.55"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.07"/>
      <stop offset="0.42" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <filter id="screen-halo" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="8"/>
    </filter>
    <filter id="led-glow" x="-120%" y="-120%" width="340%" height="340%">
      <feGaussianBlur stdDeviation="2.6" result="b"/>
      <feMerge>
        <feMergeNode in="b"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>`;
}

// The board + recessed screen + glow, minus the dot field (added by caller).
function boardBody() {
  const { x, y, w, h, r } = SCREEN;
  return `  <!-- board / bezel -->
  <rect x="0.5" y="0.5" width="${WIN.w - 1}" height="${WIN.h - 1}" rx="${WIN.r}" fill="url(#board)" stroke="rgba(244,202,112,0.30)" stroke-width="1"/>
  <rect x="6.5" y="6.5" width="${WIN.w - 13}" height="${WIN.h - 13}" rx="${WIN.r - 5}" fill="url(#ambient)"/>
  <!-- outer screen halo -->
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${PRIMARY}" opacity="0.18" filter="url(#screen-halo)"/>
  <!-- recessed screen -->
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="url(#screen)" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="url(#ambient)"/>`;
}

// Overlays drawn above the dot field: glass sheen + bottom-right vignette.
function screenOverlays() {
  const { x, y, w, h, r } = SCREEN;
  return `  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="url(#vignette)"/>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="url(#sheen)"/>`;
}

// --- 2) Empty panel: board + dim 9x9 field + glow ---------------------------
function panelWindow() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIN.w} ${WIN.h}" width="${WIN.w}" height="${WIN.h}" role="img" aria-label="jiko LED window (empty)">
  <title>jiko LED window — board, dot grid, glow</title>
${boardDefs()}
${boardBody()}
  <!-- dim dot grid (九宫格) -->
  <g>
      ${dots(FRAMES.king, FIELD_X, FIELD_Y, "dim")}
  </g>
${screenOverlays()}
</svg>
`;
}

// --- 3) Full lit window: board + field + sprite with glow -------------------
function litWindow(name) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIN.w} ${WIN.h}" width="${WIN.w}" height="${WIN.h}" role="img" aria-label="jiko ${name} window">
  <title>jiko ${name} — lit window</title>
${boardDefs()}
${boardBody()}
  <!-- dot field: dim grid + lit sprite -->
  <g>
      ${dots(FRAMES[name], FIELD_X, FIELD_Y, "all", { glow: true })}
  </g>
${screenOverlays()}
</svg>
`;
}

// --- 4) Contact sheet (all assets on one dark board) ------------------------
function contactSheet() {
  const pad = 28;
  const gap = 26;
  const colW = WIN.w;
  const sheetW = pad * 2 + colW;
  const rowH = WIN.h;
  // clean sprites row uses the 88px tiles scaled to sit on the same column
  const spriteScale = 1;
  const spriteRowH = FIELD;
  const sheetH =
    pad * 2 + spriteRowH + gap + rowH + gap + rowH * 3 + gap * 2 + 3 * 22;

  const tiles = [];
  // Row A: three clean sprites side by side
  const triW = (colW - gap * 2) / 3;
  NAMES.forEach((name, i) => {
    const sx = pad + i * (triW + gap) + (triW - FIELD) / 2;
    tiles.push(
      `<g transform="translate(${f(sx)} ${pad})">${dots(FRAMES[name], 0, 0, "lit")}</g>`,
    );
  });
  // Row B: empty panel
  let cy = pad + spriteRowH + gap;
  tiles.push(
    `<g transform="translate(${pad} ${cy})">${stripSvg(panelWindow())}</g>`,
  );
  // Rows C..E: lit windows
  NAMES.forEach((name, i) => {
    const wy = cy + rowH + gap + i * (rowH + gap);
    tiles.push(
      `<g transform="translate(${pad} ${wy})">${stripSvg(litWindow(name))}</g>`,
    );
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sheetW} ${f(sheetH)}" width="${sheetW}" height="${f(sheetH)}" role="img" aria-label="jiko asset contact sheet">
  <rect width="${sheetW}" height="${f(sheetH)}" rx="20" fill="#0a0b0d"/>
${boardDefs()}
  ${tiles.join("\n  ")}
</svg>
`;
}

// Pull the inner markup out of a generated <svg> so it can be nested in the sheet.
function stripSvg(svg) {
  return svg
    .replace(/^[\s\S]*?<defs>[\s\S]*?<\/defs>/, "")
    .replace(/<\/svg>\s*$/, "")
    .trim();
}

// --- Write everything -------------------------------------------------------
const files = {};
for (const name of NAMES) {
  files[`sprite-${name}.svg`] = cleanSprite(name);
  files[`window-${name}.svg`] = litWindow(name);
}
files["panel-window.svg"] = panelWindow();
files["contact-sheet.svg"] = contactSheet();

for (const [name, body] of Object.entries(files)) {
  writeFileSync(resolve(OUT, name), body);
  console.log(`  wrote docs/assets/svg/${name}`);
}
console.log("Done.");
