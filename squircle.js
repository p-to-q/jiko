/**
 * ═══════════════════════════════════════════════════════════════════
 *  SQUIRCLE DESIGN SYSTEM
 *  Hardware enclosure corner geometry — 98 × 70 mm form factor
 * ═══════════════════════════════════════════════════════════════════
 *
 *  WHY NOT border-radius?
 *  ─────────────────────
 *  CSS border-radius creates a circular arc joined to straight edges.
 *  The join is G1 continuous — the tangent matches, but curvature jumps
 *  from 0 (straight) to 1/r (arc) instantaneously. Your eye perceives
 *  this as a "kink" even if you can't name it.
 *
 *  A superellipse (Lamé curve) is G2 continuous — curvature changes
 *  smoothly everywhere. There's no kink, no join. The curve "breathes."
 *
 *  THE MATH
 *  ────────
 *  Standard superellipse:  |x/a|^n + |y/b|^n = 1
 *
 *    n = 2    → circle/ellipse
 *    n = 2.5  → Piet Hein's classic (Copenhagen roundabout, 1959)
 *    n = 4    → "squircle" (Apple iOS icon territory)
 *    n → ∞    → rectangle
 *
 *  Asymmetric variant:  |x/a|^m + |y/b|^n = 1, where m ≠ n
 *    → Different curvature per axis. Horizontal edges can be "flatter"
 *      (higher m) while vertical edges stay "rounder" (lower n).
 *    → Creates subtle tension the brain detects but can't name.
 *
 *  BRAND LANDSCAPE (who uses what)
 *  ───────────────────────────────
 *  Apple iOS icons ......... n ≈ 4.0, r ≈ 22% (Figma smooth 60%)
 *  Samsung OneUI ........... n ≈ 3.3
 *  Piet Hein ............... n = 2.5
 *  Nothing Phone ........... continuous curvature wrap, n ≈ 4.0
 *  Framer F1 keyboard ...... ~n ≈ 4.0–4.3 (estimated from product photos)
 *
 *  ★ OUR ZONE: n = 4.2 (uniform) / mx=4.2, ny=3.8 (asymmetric)
 *    → Unclaimed territory. More precise than Apple, less cold than n=5.
 *    → "Dieter Rams meets the squircle" — Bauhaus precision.
 *
 *  PHYSICAL PARAMETERS
 *  ───────────────────
 *  Enclosure:   98 × 70 mm  (W × H)
 *  Thickness:   ~4.7–5 mm
 *  Corner r:    8 mm  (11.4% of short side, 8.16% of long side)
 *  Exponent:    n = 4.2 (uniform) — primary recommendation
 *               mx = 4.2, ny = 3.8 (asymmetric) — for "uncanny" variant
 *
 *  2.5D GLASS EDGE
 *  ───────────────
 *  Screen glass uses the same squircle shape but with n = 3.5:
 *    → Softer curvature than the chassis = visual "pillow" effect
 *    → Inner-outer echo: same family, different personality
 *    → The 0.7 delta (4.2 vs 3.5) is perceptible as "the glass is
 *      gentler than the frame" — like how a watch crystal is softer
 *      than the case bezel.
 *
 *  Glass r should be chassis r minus bezel width. If bezel = 1mm:
 *    glass r = 7mm, glass n = 3.5
 *
 *  CNC MANUFACTURING NOTES
 *  ───────────────────────
 *  - r = 8mm → minimum ball-end mill diameter = 2 × 8mm = Ø16mm
 *    (for internal pocket corners; external corners have no minimum)
 *  - At n = 4.2 the curve deviates from a true arc by ~0.15mm at the
 *    inflection point — within standard ±0.1mm CNC tolerance if you
 *    use enough G-code segments (≥40 points per corner arc).
 *  - For injection molding: the superellipse actually improves flow
 *    because there's no abrupt curvature change at the tangent point.
 *  - Asymmetric variant (mx≠ny) adds ~0 cost — it's just different
 *    G-code coordinates, same toolpath complexity.
 *
 * ═══════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────
//  DESIGN TOKENS
// ─────────────────────────────────────────────────────────

export const DESIGN = {
  // Physical dimensions (mm)
  body: { w: 98, h: 70, depth: 4.7 },

  // Primary: Bauhaus uniform
  primary: {
    n: 4.2,
    r: 8,          // mm
    rPercent: 11.4, // % of short side (70mm)
    label: 'Dieter Rams zone — n=4.2 uniform',
  },

  // Variant: Whisper asymmetry
  asymmetric: {
    mx: 4.2,    // horizontal exponent (long edges → flatter)
    ny: 3.8,    // vertical exponent (short edges → softer)
    r: 8,
    label: 'Whisper tension — mx=4.2, ny=3.8',
  },

  // 2.5D glass edge
  glass: {
    n: 3.5,          // softer than chassis
    bezelWidth: 1,   // mm — adjust to your actual bezel
    get r() { return DESIGN.primary.r - this.bezelWidth; }, // 7mm
    label: 'Glass pillow — n=3.5, inner echo',
  },

  // Three.js mapping (normalized to your scene units)
  // bodyW=1.82 → scale = 1.82/98 = 0.01857
  three: {
    bodyW: 1.82,
    bodyH: 2.73,  // note: 3D model is portrait (W:H = 2:3)
    bodyDepth: 0.15,
    get scale() { return this.bodyW / DESIGN.body.w; },
    get radius() { return DESIGN.primary.r * this.scale; },
    get glassRadius() { return DESIGN.glass.r * this.scale; },
  },
};


// ─────────────────────────────────────────────────────────
//  CORE GEOMETRY: SUPERELLIPSE RECT PATH (SVG)
// ─────────────────────────────────────────────────────────

/**
 * Generate an SVG path for a superellipse-cornered rectangle.
 *
 * The approach: draw straight edges between corners, then for each
 * corner, parametrically trace the superellipse arc from one tangent
 * point to the other. The parametric form is:
 *
 *   x(t) = cx + r · sign(cos t) · |cos t|^(2/n)
 *   y(t) = cy + r · sign(sin t) · |sin t|^(2/n)
 *
 * where (cx, cy) is the corner center, r is the corner radius,
 * and t sweeps through the appropriate quadrant.
 *
 * @param {number} x      - Left edge
 * @param {number} y      - Top edge
 * @param {number} w      - Width
 * @param {number} h      - Height
 * @param {number} r      - Corner radius
 * @param {number} n      - Superellipse exponent (2=circle, 4=squircle, ∞=rect)
 * @param {number} [steps=120] - Total points (more = smoother, ≥80 for CNC)
 * @returns {string} SVG path d attribute
 */
export function superellipseRect(x, y, w, h, r, n, steps = 120) {
  r = Math.min(r, w / 2, h / 2);
  const pts = [];
  const seg = Math.floor(steps / 4);

  function cornerArc(cx, cy, startAngle, endAngle) {
    for (let i = 0; i <= seg; i++) {
      const t = startAngle + (i / seg) * (endAngle - startAngle);
      const cosT = Math.cos(t);
      const sinT = Math.sin(t);
      pts.push([
        cx + r * Math.sign(cosT) * Math.pow(Math.abs(cosT), 2 / n),
        cy + r * Math.sign(sinT) * Math.pow(Math.abs(sinT), 2 / n),
      ]);
    }
  }

  // Top edge → Top-right corner
  pts.push([x + r, y]);
  pts.push([x + w - r, y]);
  cornerArc(x + w - r, y + r, -Math.PI / 2, 0);

  // Right edge → Bottom-right corner
  pts.push([x + w, y + r]);
  pts.push([x + w, y + h - r]);
  cornerArc(x + w - r, y + h - r, 0, Math.PI / 2);

  // Bottom edge → Bottom-left corner
  pts.push([x + w - r, y + h]);
  pts.push([x + r, y + h]);
  cornerArc(x + r, y + h - r, Math.PI / 2, Math.PI);

  // Left edge → Top-left corner
  pts.push([x, y + h - r]);
  pts.push([x, y + r]);
  cornerArc(x + r, y + r, Math.PI, Math.PI * 1.5);

  return 'M' + pts.map(p => p[0].toFixed(3) + ',' + p[1].toFixed(3)).join(' L') + ' Z';
}


/**
 * Asymmetric superellipse rect — different exponent per axis.
 * |x/a|^mx + |y/b|^ny = 1
 *
 * mx > ny → horizontal edges flatter, vertical edges rounder
 * mx < ny → horizontal edges rounder, vertical edges flatter
 *
 * @param {number} mx - Horizontal exponent
 * @param {number} ny - Vertical exponent
 */
export function asymmetricRect(x, y, w, h, r, mx, ny, steps = 120) {
  r = Math.min(r, w / 2, h / 2);
  const pts = [];
  const seg = Math.floor(steps / 4);

  function cornerArc(cx, cy, startAngle, endAngle) {
    for (let i = 0; i <= seg; i++) {
      const t = startAngle + (i / seg) * (endAngle - startAngle);
      const cosT = Math.cos(t);
      const sinT = Math.sin(t);
      pts.push([
        cx + r * Math.sign(cosT) * Math.pow(Math.abs(cosT), 2 / mx),
        cy + r * Math.sign(sinT) * Math.pow(Math.abs(sinT), 2 / ny),
      ]);
    }
  }

  pts.push([x + r, y]);
  pts.push([x + w - r, y]);
  cornerArc(x + w - r, y + r, -Math.PI / 2, 0);
  pts.push([x + w, y + r]);
  pts.push([x + w, y + h - r]);
  cornerArc(x + w - r, y + h - r, 0, Math.PI / 2);
  pts.push([x + w - r, y + h]);
  pts.push([x + r, y + h]);
  cornerArc(x + r, y + h - r, Math.PI / 2, Math.PI);
  pts.push([x, y + h - r]);
  pts.push([x, y + r]);
  cornerArc(x + r, y + r, Math.PI, Math.PI * 1.5);

  return 'M' + pts.map(p => p[0].toFixed(3) + ',' + p[1].toFixed(3)).join(' L') + ' Z';
}


// ─────────────────────────────────────────────────────────
//  THREE.JS INTEGRATION
// ─────────────────────────────────────────────────────────

/**
 * Generate a THREE.Shape for use with ExtrudeGeometry.
 *
 * Usage in your Three.js scene:
 *
 *   import { createSquircleShape, DESIGN } from './squircle.js';
 *   import * as THREE from 'three';
 *
 *   const shape = createSquircleShape(
 *     DESIGN.three.bodyW,
 *     DESIGN.three.bodyH,  // or use bodyW for landscape
 *     DESIGN.three.radius,
 *     DESIGN.primary.n
 *   );
 *
 *   const geometry = new THREE.ExtrudeGeometry(shape, {
 *     depth: DESIGN.three.bodyDepth,
 *     bevelEnabled: true,
 *     bevelThickness: 0.005,
 *     bevelSize: 0.005,
 *     bevelSegments: 3,
 *     curveSegments: 32,
 *   });
 *
 * For the 2.5D glass layer:
 *
 *   const glassShape = createSquircleShape(
 *     DESIGN.three.bodyW - bezelInSceneUnits * 2,
 *     DESIGN.three.bodyH - bezelInSceneUnits * 2,
 *     DESIGN.three.glassRadius,
 *     DESIGN.glass.n  // 3.5 — softer than chassis
 *   );
 *
 * @param {number} w      - Width in scene units
 * @param {number} h      - Height in scene units
 * @param {number} r      - Corner radius in scene units
 * @param {number} n      - Superellipse exponent
 * @param {number} [steps=120] - Points per full outline
 * @returns {THREE.Shape}  (requires THREE to be in scope)
 */
export function createSquircleShape(w, h, r, n, steps = 120) {
  // Generate 2D points centered at origin
  const points = squirclePoints(w, h, r, n, steps);

  // Assumes THREE is available globally or imported by caller
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    shape.lineTo(points[i][0], points[i][1]);
  }
  shape.closePath();
  return shape;
}

/**
 * Same as createSquircleShape but for asymmetric exponents.
 */
export function createAsymSquircleShape(w, h, r, mx, ny, steps = 120) {
  const points = asymSquirclePoints(w, h, r, mx, ny, steps);
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    shape.lineTo(points[i][0], points[i][1]);
  }
  shape.closePath();
  return shape;
}


// ─────────────────────────────────────────────────────────
//  RAW POINT ARRAYS (for any renderer)
// ─────────────────────────────────────────────────────────

/**
 * Returns [[x,y], ...] array of points for a superellipse rect,
 * centered at origin. Useful for Three.js, Canvas, DXF export, etc.
 */
export function squirclePoints(w, h, r, n, steps = 120) {
  r = Math.min(r, w / 2, h / 2);
  const pts = [];
  const seg = Math.floor(steps / 4);
  const hw = w / 2, hh = h / 2;

  function arc(cx, cy, sa, ea) {
    for (let i = 0; i <= seg; i++) {
      const t = sa + (i / seg) * (ea - sa);
      const c = Math.cos(t), s = Math.sin(t);
      pts.push([
        cx + r * Math.sign(c) * Math.pow(Math.abs(c), 2 / n),
        cy + r * Math.sign(s) * Math.pow(Math.abs(s), 2 / n),
      ]);
    }
  }

  // Centered at origin: corners at (±hw, ±hh)
  pts.push([-hw + r, -hh]);
  pts.push([hw - r, -hh]);
  arc(hw - r, -hh + r, -Math.PI / 2, 0);         // top-right
  pts.push([hw, -hh + r]);
  pts.push([hw, hh - r]);
  arc(hw - r, hh - r, 0, Math.PI / 2);            // bottom-right
  pts.push([hw - r, hh]);
  pts.push([-hw + r, hh]);
  arc(-hw + r, hh - r, Math.PI / 2, Math.PI);     // bottom-left
  pts.push([-hw, hh - r]);
  pts.push([-hw, -hh + r]);
  arc(-hw + r, -hh + r, Math.PI, Math.PI * 1.5);  // top-left

  return pts;
}

/**
 * Asymmetric version of squirclePoints.
 */
export function asymSquirclePoints(w, h, r, mx, ny, steps = 120) {
  r = Math.min(r, w / 2, h / 2);
  const pts = [];
  const seg = Math.floor(steps / 4);
  const hw = w / 2, hh = h / 2;

  function arc(cx, cy, sa, ea) {
    for (let i = 0; i <= seg; i++) {
      const t = sa + (i / seg) * (ea - sa);
      const c = Math.cos(t), s = Math.sin(t);
      pts.push([
        cx + r * Math.sign(c) * Math.pow(Math.abs(c), 2 / mx),
        cy + r * Math.sign(s) * Math.pow(Math.abs(s), 2 / ny),
      ]);
    }
  }

  pts.push([-hw + r, -hh]);
  pts.push([hw - r, -hh]);
  arc(hw - r, -hh + r, -Math.PI / 2, 0);
  pts.push([hw, -hh + r]);
  pts.push([hw, hh - r]);
  arc(hw - r, hh - r, 0, Math.PI / 2);
  pts.push([hw - r, hh]);
  pts.push([-hw + r, hh]);
  arc(-hw + r, hh - r, Math.PI / 2, Math.PI);
  pts.push([-hw, hh - r]);
  pts.push([-hw, -hh + r]);
  arc(-hw + r, -hh + r, Math.PI, Math.PI * 1.5);

  return pts;
}


// ─────────────────────────────────────────────────────────
//  CSS FALLBACK
// ─────────────────────────────────────────────────────────

/**
 * For web UI elements that echo the hardware shape.
 *
 * Option A — Native CSS (Chrome 139+, ~67% coverage as of 2026):
 *   corner-shape: squircle;
 *   border-radius: 11.4%;
 *
 * Option B — SVG clip-path (universal):
 *   clip-path: path("...");  // use superellipseRect() output
 *
 * Option C — NPM packages:
 *   figma-squircle    → Bézier approximation, Figma-compatible
 *   @squircle-js/react → React component wrapper
 *   html-squircle     → CSS Houdini paint worklet
 */
export function cssSnippet() {
  return {
    native: `/* Chrome 139+ */
corner-shape: squircle;
border-radius: 11.4%;`,

    clipPath: `/* Universal — paste SVG path from superellipseRect() */
clip-path: path("${superellipseRect(0, 0, 98, 70, 8, 4.2, 80)}");`,
  };
}


// ─────────────────────────────────────────────────────────
//  QUICK-USE: PRE-BUILT PATHS AT PHYSICAL DIMENSIONS
// ─────────────────────────────────────────────────────────

/** Chassis outline at 98×70mm, r=8mm, n=4.2 */
export const CHASSIS_PATH = superellipseRect(0, 0, 98, 70, 8, 4.2);

/** Asymmetric chassis: mx=4.2, ny=3.8 */
export const CHASSIS_ASYM_PATH = asymmetricRect(0, 0, 98, 70, 8, 4.2, 3.8);

/** Glass cutout: 96×68mm (1mm bezel), r=7mm, n=3.5 */
export const GLASS_PATH = superellipseRect(1, 1, 96, 68, 7, 3.5);

/** For reference: what border-radius looks like (circular arc) */
export const BORDER_RADIUS_PATH = superellipseRect(0, 0, 98, 70, 8, 2);


// ─────────────────────────────────────────────────────────
//  LAYER SYSTEM (chassis + glass + screen)
// ─────────────────────────────────────────────────────────

/**
 * Returns all layers needed to render the full device cross-section.
 * Each layer has: name, path (SVG), n, r, offset from chassis edge.
 *
 * Usage:
 *   const layers = getDeviceLayers();
 *   layers.forEach(l => {
 *     svgGroup.append('path').attr('d', l.path).attr('fill', l.fill);
 *   });
 */
export function getDeviceLayers(bezel = 1) {
  const W = 98, H = 70;
  return [
    {
      name: 'chassis',
      path: superellipseRect(0, 0, W, H, 8, 4.2),
      n: 4.2, r: 8,
      fill: 'none', stroke: '#555', strokeWidth: 2,
      note: 'CNC aluminum / injection-molded polycarbonate',
    },
    {
      name: 'glass',
      path: superellipseRect(bezel, bezel, W - bezel * 2, H - bezel * 2, 8 - bezel, 3.5),
      n: 3.5, r: 8 - bezel,
      fill: 'rgba(255,255,255,0.03)', stroke: '#888', strokeWidth: 0.5,
      note: '2.5D edge, n=3.5 — softer than chassis, "pillow" effect',
    },
    {
      name: 'screen',
      path: superellipseRect(bezel + 0.5, bezel + 0.5, W - (bezel + 0.5) * 2, H - (bezel + 0.5) * 2, 7, 3.5),
      n: 3.5, r: 7,
      fill: '#111', stroke: 'none', strokeWidth: 0,
      note: 'Active display area',
    },
  ];
}


// ─────────────────────────────────────────────────────────
//  DXF EXPORT (for CNC / laser cutting)
// ─────────────────────────────────────────────────────────

/**
 * Generates a minimal DXF string from a point array.
 * Import this into Fusion 360, SolidWorks, or send to CNC shop.
 *
 * Usage:
 *   const pts = squirclePoints(98, 70, 8, 4.2, 200);
 *   const dxf = pointsToDXF(pts);
 *   // save as .dxf file
 */
export function pointsToDXF(points) {
  let dxf = '0\nSECTION\n2\nENTITIES\n';
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    dxf += `0\nLINE\n8\n0\n10\n${a[0].toFixed(4)}\n20\n${a[1].toFixed(4)}\n30\n0\n11\n${b[0].toFixed(4)}\n21\n${b[1].toFixed(4)}\n31\n0\n`;
  }
  dxf += '0\nENDSEC\n0\nEOF\n';
  return dxf;
}


// ─────────────────────────────────────────────────────────
//  CURVATURE ANALYSIS (for verification)
// ─────────────────────────────────────────────────────────

/**
 * Compute curvature κ at each point of a superellipse.
 * Useful for verifying G2 continuity and comparing curves.
 *
 * κ = |x'y'' - y'x''| / (x'^2 + y'^2)^(3/2)
 *
 * For a superellipse with exponent n:
 *   κ(t) = (n-1) / (r · (|cos t|^(2n/(n-2)) + |sin t|^(2n/(n-2)))^((n-2)/(2n)))
 *
 * Returns array of { angle, curvature } for one corner (0 to π/2).
 */
export function curvatureProfile(r, n, samples = 100) {
  const result = [];
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * Math.PI / 2;
    const ct = Math.cos(t), st = Math.sin(t);

    // Numerical derivatives of parametric form
    const dt = 0.0001;
    const x0 = r * Math.sign(Math.cos(t - dt)) * Math.pow(Math.abs(Math.cos(t - dt)), 2 / n);
    const x1 = r * Math.sign(Math.cos(t + dt)) * Math.pow(Math.abs(Math.cos(t + dt)), 2 / n);
    const y0 = r * Math.sign(Math.sin(t - dt)) * Math.pow(Math.abs(Math.sin(t - dt)), 2 / n);
    const y1 = r * Math.sign(Math.sin(t + dt)) * Math.pow(Math.abs(Math.sin(t + dt)), 2 / n);

    const xc = r * Math.sign(ct) * Math.pow(Math.abs(ct), 2 / n);
    const yc = r * Math.sign(st) * Math.pow(Math.abs(st), 2 / n);

    const dx = (x1 - x0) / (2 * dt);
    const dy = (y1 - y0) / (2 * dt);
    const ddx = (x1 - 2 * xc + x0) / (dt * dt);
    const ddy = (y1 - 2 * yc + y0) / (dt * dt);

    const kappa = Math.abs(dx * ddy - dy * ddx) / Math.pow(dx * dx + dy * dy, 1.5);

    result.push({ angle: t * 180 / Math.PI, curvature: kappa });
  }
  return result;
}
