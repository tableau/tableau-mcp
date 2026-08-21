import { decode as decodePngFast } from 'fast-png';

// A lightweight scan for Tableau's error-pill red over the PNG bytes
// capture-window-screenshot already holds server-side. The goal is a CHEAP triage signal —
// "this window probably has a red error pill, look closer" — not an authoritative verdict:
// red is overloaded in Tableau (mark colors, negative-value formatting, reference lines), so a
// hit escalates to real inspection rather than standing in for it.
//
// The signal is SHAPE, not density. A red field pill is a consistent UI element: a solid,
// rounded-cornered capsule of a fixed height (it stretches horizontally as the field name
// grows, but the rounded end-caps never change). Measured across real captures at one DPI, the
// cap ramps from the tip to the full pill height over ~half the pill height, following a convex
// arc — identical column-for-column whatever the pill's length. So the detector groups red
// pixels into connected components and looks for that capsule profile (a flat plateau with at
// least one rounded end-cap), expressed entirely as ratios of the plateau height so it is
// invariant to capture DPI and to how long the pill happens to be. A square-cornered red bar,
// a red mark, or red scattered through a viz does not produce that profile.

export type DecodedImage = {
  width: number;
  height: number;
  /** 3 for RGB, 4 for RGBA. */
  channels: number;
  /** Row-major pixel bytes: width*height*channels. */
  data: Buffer;
};

/**
 * Decode PNG bytes to raw 8-bit RGB/RGBA pixels via fast-png — a pure-JS decoder (no native
 * binary, so it bundles into the desktop single-executable). fast-png transparently handles
 * filtering and interlacing. Returns null for layouts the scan does not handle (16-bit,
 * palette/grayscale) or for undecodable bytes, so the caller degrades to "could not scan"
 * rather than throwing.
 */
export function decodePng(bytes: Buffer): DecodedImage | null {
  let decoded;
  try {
    decoded = decodePngFast(bytes);
  } catch {
    return null;
  }
  const { width, height, channels, depth, data } = decoded;
  if (depth !== 8 || (channels !== 3 && channels !== 4) || !(data instanceof Uint8Array)) {
    return null;
  }
  // Zero-copy Buffer view over the decoded bytes; the scan indexes it directly.
  return {
    width,
    height,
    channels,
    data: Buffer.from(data.buffer, data.byteOffset, data.byteLength),
  };
}

/**
 * Whether a pixel reads as Tableau's error-pill red: a strongly red hue (high R, low G/B, R
 * clearly dominant). Calibrated against real captures whose pill body is ~#E84858
 * (232,72,88). Deliberately narrow to keep legitimate pinks/oranges/dark maroons out; a genuine
 * pure-red mark can still match on color, which is why the pill test below keys on SHAPE, not
 * on the raw count of matching pixels.
 */
export function isErrorRed(r: number, g: number, b: number): boolean {
  return r >= 150 && g <= 95 && b <= 95 && r - Math.max(g, b) >= 60;
}

/** A red connected component that matched the field-pill capsule profile. */
export type PillMatch = {
  /** Bounding-box left/top and size, in image pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The pill's solid-body height (the column-extent plateau). */
  plateauHeight: number;
  /** Red pixels as a fraction of the bounding-box area (a solid pill is high, ~0.8). */
  fill: number;
  /** How many rounded end-caps matched (1 when the far end is clipped at the shelf edge, else 2). */
  caps: number;
};

export type ErrorRedScan = {
  width: number;
  height: number;
  /** Total error-red pixels in the image (context for logging; NOT the trigger). */
  redPixels: number;
  redFraction: number;
  /** True when a red field-pill shape was found — this is the signal to act on. */
  pillFound: boolean;
  /** The matched pill (the largest, when several match); null when none matched. */
  pill: PillMatch | null;
};

// --- Pill-shape thresholds (all ratios of the plateau height H, so DPI/length invariant) -----

// The tip column of a rounded cap is near-empty; a square corner (bar, rectangle) is full height
// at its very edge and fails this immediately.
const CAP_TIP_MAX_FRAC = 0.35;
// Extent at which a cap is considered to have reached the solid body.
const CAP_PLATEAU_FRAC = 0.85;
// The cap must ramp to the body over at least this many columns (reject a 1px "taper" that is
// really a square corner) and at most this many (a longer diagonal is not a cap).
const CAP_SPAN_MIN_FRAC = 0.15;
const CAP_SPAN_MAX_FRAC = 1.1;
// Convexity: at the ramp's midpoint a circular cap bulges well above the straight tip→body line
// (a linear/triangular ramp sits at ~0.5·H there and is rejected).
const CAP_MID_MIN_FRAC = 0.6;
// Anti-aliasing can wobble the ramp by a pixel or two; tolerate a small non-monotonic dip.
const CAP_MONOTONIC_TOL_PX = 3;

// A pill has a sustained flat body between its caps; a red disc/mark peaks for a column or two
// and fails this. Both an absolute floor (tiny images) and a fraction of H (larger captures).
const PLATEAU_RUN_MIN_PX = 4;
const PLATEAU_RUN_MIN_FRAC = 0.4;

// Floors that keep noise out: a plateau below this many pixels is too small to judge, and a
// component below this many red pixels is not a pill.
const MIN_PLATEAU_HEIGHT_PX = 8;
const MIN_COMPONENT_PIXELS = 40;
// A pill is solid; an outline/ring or a sparse cluster is not.
const MIN_BBOX_FILL = 0.5;
// A pill is elongated: even a short (truncated field name) pill is meaningfully wider than tall,
// whereas a round mark is ~1:1. Separates the two without rejecting a short pill.
const MIN_WIDTH_TO_HEIGHT = 1.4;

type Component = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  count: number;
  /** Per-column vertical extent (maxY-minY+1) within the bbox; 0 where the column has no pixel.
   * Extent (not pixel count) so the white text punched into a pill's middle does not create
   * false gaps — the pill's top and bottom borders still span the full height there. */
  colExtent: Int32Array;
};

/**
 * Label error-red pixels into 8-connected components (union-find), returning per-component
 * bounding box, pixel count, and column-extent profile. One O(width*height) pass to label plus
 * a bbox-bounded pass per component to build profiles — cheap enough for a per-apply best-effort
 * scan. 8-connectivity so a cap's anti-aliased single-pixel diagonal edge does not split it.
 */
function findErrorRedComponents(image: DecodedImage): {
  components: Component[];
  totalRed: number;
} {
  const { width, height, channels, data } = image;
  const labels = new Int32Array(width * height).fill(-1);
  const parent: number[] = [];
  const find = (a: number): number => {
    let r = a;
    while (parent[r] !== r) r = parent[r];
    while (parent[a] !== r) {
      const n = parent[a];
      parent[a] = r;
      a = n;
    }
    return r;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  let next = 0;
  const redAt = (x: number, y: number): boolean => {
    const p = (y * width + x) * channels;
    return isErrorRed(data[p], data[p + 1], data[p + 2]);
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!redAt(x, y)) continue;
      // Already-visited neighbors (row above + left) under 8-connectivity.
      let lbl = -1;
      const consider = (nx: number, ny: number): void => {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
        const nl = labels[ny * width + nx];
        if (nl < 0) return;
        if (lbl < 0) lbl = find(nl);
        else union(lbl, nl);
      };
      consider(x - 1, y);
      consider(x - 1, y - 1);
      consider(x, y - 1);
      consider(x + 1, y - 1);
      if (lbl < 0) {
        lbl = next;
        parent[next] = next;
        next += 1;
      }
      labels[y * width + x] = lbl;
    }
  }

  // Accumulate bbox + count per resolved root, and the grand total of error-red pixels
  // (over ALL components, before the size filter below) so the caller can report honest
  // red-pixel context even when every component is too small to be a pill.
  type Stats = { x0: number; y0: number; x1: number; y1: number; count: number };
  const byRoot = new Map<number, Stats>();
  let totalRed = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const l = labels[y * width + x];
      if (l < 0) continue;
      totalRed += 1;
      const root = find(l);
      let s = byRoot.get(root);
      if (!s) {
        s = { x0: x, y0: y, x1: x, y1: y, count: 0 };
        byRoot.set(root, s);
      }
      if (x < s.x0) s.x0 = x;
      if (y < s.y0) s.y0 = y;
      if (x > s.x1) s.x1 = x;
      if (y > s.y1) s.y1 = y;
      s.count += 1;
      labels[y * width + x] = root; // flatten for the profile pass
    }
  }

  const components: Component[] = [];
  for (const [root, s] of byRoot) {
    if (s.count < MIN_COMPONENT_PIXELS) continue;
    const bw = s.x1 - s.x0 + 1;
    const colTop = new Int32Array(bw).fill(-1);
    const colBot = new Int32Array(bw).fill(-1);
    for (let y = s.y0; y <= s.y1; y++) {
      for (let x = s.x0; x <= s.x1; x++) {
        if (labels[y * width + x] !== root) continue;
        const c = x - s.x0;
        if (colTop[c] < 0) colTop[c] = y;
        colBot[c] = y;
      }
    }
    const colExtent = new Int32Array(bw);
    for (let c = 0; c < bw; c++) {
      colExtent[c] = colTop[c] < 0 ? 0 : colBot[c] - colTop[c] + 1;
    }
    components.push({ x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1, count: s.count, colExtent });
  }
  return { components, totalRed };
}

/** Whether the end of `colExtent` (left or right) ramps up as a rounded, convex cap. */
function hasRoundedCap(colExtent: Int32Array, fromLeft: boolean, H: number): boolean {
  const w = colExtent.length;
  const at = (i: number): number => colExtent[fromLeft ? i : w - 1 - i];
  const tip = at(0);
  if (tip > CAP_TIP_MAX_FRAC * H) return false; // square corner, not a cap

  const plateauMin = CAP_PLATEAU_FRAC * H;
  const maxSpan = Math.min(w - 1, Math.ceil(CAP_SPAN_MAX_FRAC * H));
  let peak = tip;
  let span = -1;
  for (let i = 1; i <= maxSpan; i++) {
    const e = at(i);
    if (e + CAP_MONOTONIC_TOL_PX < peak) return false; // must climb, not dip back down
    if (e > peak) peak = e;
    if (e >= plateauMin) {
      span = i;
      break;
    }
  }
  if (span < 0) return false; // never reached the body within the allowed span
  if (span < CAP_SPAN_MIN_FRAC * H) return false; // too abrupt to be a rounded corner
  // Convexity: the arc bulges above the straight tip→body line at its midpoint.
  return at(Math.floor(span / 2)) >= CAP_MID_MIN_FRAC * H;
}

/** Longest run of columns at (near) the full plateau height — a pill's solid middle. */
function longestPlateauRun(colExtent: Int32Array, H: number): number {
  const min = CAP_PLATEAU_FRAC * H;
  let best = 0;
  let cur = 0;
  for (let i = 0; i < colExtent.length; i++) {
    if (colExtent[i] >= min) {
      cur += 1;
      if (cur > best) best = cur;
    } else {
      cur = 0;
    }
  }
  return best;
}

/** Test one component's column profile for the field-pill capsule shape. */
function matchPill(c: Component): PillMatch | null {
  const bw = c.x1 - c.x0 + 1;
  const bh = c.y1 - c.y0 + 1;

  let H = 0;
  for (let i = 0; i < c.colExtent.length; i++) {
    if (c.colExtent[i] > H) H = c.colExtent[i];
  }
  if (H < MIN_PLATEAU_HEIGHT_PX) return null;

  // Elongated and horizontal: a pill is meaningfully wider than its body height (rejects a
  // vertical bar and a round mark, both of which are ~1:1 or taller than wide).
  if (bw < MIN_WIDTH_TO_HEIGHT * H) return null;

  const fill = c.count / (bw * bh);
  if (fill < MIN_BBOX_FILL) return null;

  const plateauRun = longestPlateauRun(c.colExtent, H);
  if (plateauRun < Math.max(PLATEAU_RUN_MIN_PX, PLATEAU_RUN_MIN_FRAC * H)) return null;

  const caps =
    (hasRoundedCap(c.colExtent, true, H) ? 1 : 0) + (hasRoundedCap(c.colExtent, false, H) ? 1 : 0);
  if (caps < 1) return null;

  return { x: c.x0, y: c.y0, width: bw, height: bh, plateauHeight: H, fill, caps };
}

/**
 * Scan decoded pixels for a red field-pill shape. Groups error-red pixels into connected
 * components and returns the largest one matching the capsule profile (flat body + a rounded
 * end-cap). `pillFound` is the trigger; `redPixels`/`redFraction` are context only.
 */
export function scanForErrorRed(image: DecodedImage): ErrorRedScan {
  const { width, height } = image;
  const { components, totalRed } = findErrorRedComponents(image);

  let best: PillMatch | null = null;
  for (const c of components) {
    const pill = matchPill(c);
    if (pill && (!best || pill.width * pill.height > best.width * best.height)) {
      best = pill;
    }
  }

  return {
    width,
    height,
    redPixels: totalRed,
    redFraction: totalRed / (width * height),
    pillFound: best !== null,
    pill: best,
  };
}

export function isSuspiciousErrorRed(scan: ErrorRedScan): boolean {
  return scan.pillFound;
}

/**
 * Decode PNG bytes and scan for a red field pill in one step. Returns null when the bytes are
 * not a decodable 8-bit RGB/RGBA PNG, so the caller can say "scan unavailable" rather than
 * treating an undecodable capture as clean.
 */
export function scanPngForErrorRed(bytes: Buffer): ErrorRedScan | null {
  const image = decodePng(bytes);
  return image ? scanForErrorRed(image) : null;
}
