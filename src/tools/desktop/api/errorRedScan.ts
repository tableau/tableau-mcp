import { inflateSync } from 'zlib';

// PROTOTYPE (not yet wired into any tool). A lightweight, dependency-free scan for
// Tableau's error-pill red directly on the PNG bytes capture-window-screenshot already
// holds server-side. The goal is a CHEAP triage signal — "this window probably has a red
// error indicator, look closer" — not an authoritative verdict: red is overloaded in
// Tableau (mark colors, negative-value formatting, reference lines), so a hit escalates to
// real inspection rather than standing in for it. Uses Node's built-in zlib to inflate the
// IDAT stream; no image library.

const PNG_SIGNATURE_HEX = '89504e470d0a1a0a';

export type DecodedImage = {
  width: number;
  height: number;
  /** 3 for RGB, 4 for RGBA. */
  channels: number;
  /** Unfiltered, row-major pixel bytes: width*height*channels. */
  data: Buffer;
};

/**
 * Paeth predictor (PNG filter type 4). a = left, b = above, c = upper-left.
 */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  return pb <= pc ? b : c;
}

/**
 * Decode an 8-bit, non-interlaced RGB (colorType 2) or RGBA (colorType 6) PNG to raw
 * pixels. Returns null for anything else (palette, 16-bit, interlaced, malformed) so the
 * caller degrades to "could not scan" rather than throwing. CRCs are skipped, not verified
 * — this reads a screenshot Tableau just wrote, not untrusted input.
 */
export function decodePng(bytes: Buffer): DecodedImage | null {
  if (bytes.length < 8 || bytes.subarray(0, 8).toString('hex') !== PNG_SIGNATURE_HEX) {
    return null;
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idatChunks: Buffer[] = [];

  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    if (dataStart + length > bytes.length) {
      return null;
    }
    if (type === 'IHDR') {
      width = bytes.readUInt32BE(dataStart);
      height = bytes.readUInt32BE(dataStart + 4);
      bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
      interlace = bytes[dataStart + 12];
    } else if (type === 'IDAT') {
      idatChunks.push(bytes.subarray(dataStart, dataStart + length));
    } else if (type === 'IEND') {
      break;
    }
    offset = dataStart + length + 4; // + 4-byte CRC
  }

  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
  if (bitDepth !== 8 || interlace !== 0 || channels === 0 || width === 0 || height === 0) {
    return null;
  }

  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idatChunks));
  } catch {
    return null;
  }

  const stride = width * channels;
  // Each scanline is prefixed by a 1-byte filter type.
  if (raw.length < (stride + 1) * height) {
    return null;
  }

  const out = Buffer.alloc(stride * height);
  let rawPos = 0;
  for (let y = 0; y < height; y++) {
    const filterType = raw[rawPos];
    rawPos += 1;
    const rowStart = y * stride;
    const prevRowStart = rowStart - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[rawPos + i];
      const a = i >= channels ? out[rowStart + i - channels] : 0;
      const b = y > 0 ? out[prevRowStart + i] : 0;
      const c = y > 0 && i >= channels ? out[prevRowStart + i - channels] : 0;
      let value: number;
      switch (filterType) {
        case 0:
          value = x;
          break;
        case 1:
          value = x + a;
          break;
        case 2:
          value = x + b;
          break;
        case 3:
          value = x + ((a + b) >> 1);
          break;
        case 4:
          value = x + paeth(a, b, c);
          break;
        default:
          return null;
      }
      out[rowStart + i] = value & 0xff;
    }
    rawPos += stride;
  }

  return { width, height, channels, data: out };
}

/**
 * Whether a pixel reads as Tableau's error red: a strongly red hue (high R, low G/B, R
 * clearly dominant). Deliberately narrow to keep legitimate pinks/oranges/dark maroons out;
 * it will still match a genuine pure-red mark, which is why the caller uses localized
 * DENSITY (below), not raw count, as the real signal.
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
