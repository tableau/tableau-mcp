import { describe, expect, it } from 'vitest';
import { deflateSync } from 'zlib';

import { DecodedImage, decodePng, isErrorRed, scanForErrorRed } from './errorRedScan.js';

// Build a synthetic RGB DecodedImage from a (x,y)->[r,g,b] painter, so pixel-level tests
// run without constructing PNG bytes.
function makeImage(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number],
): DecodedImage {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const p = (y * width + x) * 3;
      data[p] = r;
      data[p + 1] = g;
      data[p + 2] = b;
    }
  }
  return { width, height, channels: 3, data };
}

// Minimal 8-bit RGB PNG (filter 0 on every row, dummy CRCs — the decoder skips CRC).
function makePng(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number],
): Buffer {
  const chunk = (type: string, body: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length, 0);
    return Buffer.concat([len, Buffer.from(type, 'ascii'), body, Buffer.alloc(4)]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  // comp/filter/interlace all 0.

  const stride = width * 3;
  const rawRows = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    rawRows[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const p = rowStart + 1 + x * 3;
      rawRows[p] = r;
      rawRows[p + 1] = g;
      rawRows[p + 2] = b;
    }
  }

  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rawRows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const ERROR_RED: [number, number, number] = [190, 40, 40];
const WHITE: [number, number, number] = [255, 255, 255];

describe('isErrorRed', () => {
  it('matches Tableau error-pill red', () => {
    expect(isErrorRed(190, 40, 40)).toBe(true);
    expect(isErrorRed(210, 25, 30)).toBe(true);
  });

  it('rejects non-error colors', () => {
    expect(isErrorRed(255, 255, 255)).toBe(false); // white
    expect(isErrorRed(40, 40, 40)).toBe(false); // dark gray
    expect(isErrorRed(40, 90, 200)).toBe(false); // blue
    expect(isErrorRed(240, 150, 60)).toBe(false); // orange (G too high)
    expect(isErrorRed(150, 110, 110)).toBe(false); // muted maroon (not dominant enough)
  });
});

describe('scanForErrorRed', () => {
  it('flags a small DENSE red block with a high densest-cell fraction', () => {
    // A 40x20 solid red pill on a 480x270 white canvas: tiny overall, but saturates its cell.
    const image = makeImage(480, 270, (x, y) =>
      x >= 60 && x < 100 && y >= 40 && y < 60 ? ERROR_RED : WHITE,
    );
    const scan = scanForErrorRed(image);

    expect(scan.redFraction).toBeLessThan(0.01); // barely any red overall
    expect(scan.maxCellRedFraction).toBeGreaterThan(0.9); // but its cell is nearly all red
  });

  it('does not spike the density signal for red scattered thinly across the viz', () => {
    // Same number of red pixels as a ~35px block, but sprinkled one-every-13 across the whole
    // canvas (think: red marks in a scatterplot). No single cell fills up.
    const image = makeImage(480, 270, (x, y) => ((x * 7 + y * 13) % 169 === 0 ? ERROR_RED : WHITE));
    const scan = scanForErrorRed(image);

    expect(scan.redPixels).toBeGreaterThan(400); // plenty of red pixels in total
    expect(scan.maxCellRedFraction).toBeLessThan(0.2); // yet no dense cluster
  });

  it('reports zero on a clean window', () => {
    const scan = scanForErrorRed(makeImage(200, 100, () => WHITE));
    expect(scan.redPixels).toBe(0);
    expect(scan.maxCellRedFraction).toBe(0);
  });
});

describe('decodePng', () => {
  it('round-trips an 8-bit RGB image through unfiltering', () => {
    const paint = (x: number, y: number): [number, number, number] =>
      x === y ? ERROR_RED : [x * 10, y * 10, 100];
    const decoded = decodePng(makePng(6, 4, paint));

    expect(decoded).not.toBeNull();
    expect(decoded?.width).toBe(6);
    expect(decoded?.height).toBe(4);
    expect(decoded?.channels).toBe(3);
    // Spot-check the diagonal error-red pixel and a formula pixel.
    const at = (img: DecodedImage, x: number, y: number): [number, number, number] => {
      const p = (y * img.width + x) * 3;
      return [img.data[p], img.data[p + 1], img.data[p + 2]];
    };
    expect(at(decoded!, 2, 2)).toEqual(ERROR_RED);
    expect(at(decoded!, 5, 1)).toEqual([50, 10, 100]);
  });

  it('scans a decoded PNG containing a red block', () => {
    const decoded = decodePng(
      makePng(96, 54, (x, y) => (x >= 10 && x < 22 && y >= 10 && y < 18 ? ERROR_RED : WHITE)),
    );
    const scan = scanForErrorRed(decoded!);
    expect(scan.maxCellRedFraction).toBeGreaterThan(0.5);
  });

  it('returns null for a non-PNG or unsupported variant', () => {
    expect(decodePng(Buffer.from('not a png'))).toBeNull();
    expect(decodePng(Buffer.alloc(4))).toBeNull();
  });
});
