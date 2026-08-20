import { decode as decodePngFast } from 'fast-png';

// A lightweight scan for Tableau's error-pill red over the PNG bytes
// capture-window-screenshot already holds server-side. The goal is a CHEAP triage signal —
// "this window probably has a red error indicator, look closer" — not an authoritative
// verdict: red is overloaded in Tableau (mark colors, negative-value formatting, reference
// lines), so a hit escalates to real inspection rather than standing in for it.

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
  // Zero-copy Buffer view over the decoded bytes; scanForErrorRed indexes it directly.
  return {
    width,
    height,
    channels,
    data: Buffer.from(data.buffer, data.byteOffset, data.byteLength),
  };
}

/**
 * Whether a pixel reads as Tableau's error red: a strongly red hue (high R, low G/B, R
 * clearly dominant). Deliberately narrow to keep legitimate pinks/oranges/dark maroons out;
 * it will still match a genuine pure-red mark, which is why the caller uses localized
 * DENSITY (below), not raw count, as the real signal. Hue alone cannot separate the error
 * red (~#E84050) from Tableau's default categorical viz red (#E15759, only ~26 apart), so
 * the scan does not try to — density and location do the separating.
 */
export function isErrorRed(r: number, g: number, b: number): boolean {
  return r >= 150 && g <= 95 && b <= 95 && r - Math.max(g, b) >= 60;
}

export type ErrorRedScan = {
  width: number;
  height: number;
  redPixels: number;
  /** Error-red pixels as a fraction of the whole image. */
  redFraction: number;
  /** Error-red pixels in the single densest grid cell. */
  maxCellRedPixels: number;
  /** Densest cell's error-red pixels as a fraction of that cell's area (0..1). */
  maxCellRedFraction: number;
};

/**
 * Scan decoded pixels for error red, bucketing hits into a coarse grid so a small, DENSE
 * cluster (a pill, a solid red glyph) is distinguishable from red thinly scattered across
 * the viz (mark colors). `maxCellRedFraction` — how saturated the hottest cell is — is the
 * signal to threshold on; raw `redFraction` alone conflates the two.
 */
export function scanForErrorRed(
  image: DecodedImage,
  { gridCols = 48, gridRows = 27 }: { gridCols?: number; gridRows?: number } = {},
): ErrorRedScan {
  const { width, height, channels, data } = image;
  const cells = new Int32Array(gridCols * gridRows);
  let redPixels = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * channels;
      if (isErrorRed(data[p], data[p + 1], data[p + 2])) {
        redPixels += 1;
        const cx = Math.min(gridCols - 1, Math.floor((x / width) * gridCols));
        const cy = Math.min(gridRows - 1, Math.floor((y / height) * gridRows));
        cells[cy * gridCols + cx] += 1;
      }
    }
  }

  let maxCellRedPixels = 0;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] > maxCellRedPixels) {
      maxCellRedPixels = cells[i];
    }
  }

  const cellArea = (width / gridCols) * (height / gridRows);
  return {
    width,
    height,
    redPixels,
    redFraction: redPixels / (width * height),
    maxCellRedPixels,
    maxCellRedFraction: maxCellRedPixels / cellArea,
  };
}

// Density at which the hottest grid cell reads as a deliberate red element (pill / glyph)
// rather than incidental red scattered through a viz. Calibrated against a real capture
// with a single error pill: that pill scored 0.47 while its total footprint was 0.15% of
// the window; thinly scattered red stays under ~0.2. This is a TRIAGE threshold — a hit
// means "look closer", not "confirmed broken" (a legitimately solid-red viz element trips
// it too), so the cost of it being a touch low is an extra glance, never a wrong verdict.
export const SUSPICIOUS_CELL_RED_FRACTION = 0.3;

export function isSuspiciousErrorRed(scan: ErrorRedScan): boolean {
  return scan.maxCellRedFraction >= SUSPICIOUS_CELL_RED_FRACTION;
}

/**
 * Decode PNG bytes and scan for error red in one step. Returns null when the bytes are not
 * a decodable 8-bit RGB/RGBA PNG, so the caller can say "scan unavailable" rather than
 * treating an undecodable capture as clean.
 */
export function scanPngForErrorRed(bytes: Buffer): ErrorRedScan | null {
  const image = decodePng(bytes);
  return image ? scanForErrorRed(image) : null;
}
