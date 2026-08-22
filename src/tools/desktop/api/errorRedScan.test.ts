import { encode as encodePng } from 'fast-png';
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import {
  DecodedImage,
  decodePng,
  isErrorRed,
  scanForErrorRed,
  scanPngForErrorRed,
} from './errorRedScan.js';

const fixture = (name: string): Buffer =>
  readFileSync(join(process.cwd(), 'src', 'tools', 'desktop', 'api', '__fixtures__', name));

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

// Encode a real 8-bit RGB PNG (via fast-png) so decodePng is exercised against genuine
// PNG bytes rather than a hand-rolled fixture.
function makePng(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number],
): Buffer {
  const { data } = makeImage(width, height, paint);
  return Buffer.from(encodePng({ width, height, channels: 3, depth: 8, data }));
}

const ERROR_RED: [number, number, number] = [190, 40, 40];
const WHITE: [number, number, number] = [255, 255, 255];

// A horizontal capsule = the field-pill shape: a solid rounded rectangle with semicircular
// end-caps of radius H/2. `text` optionally punches a white hole through the middle rows to
// mimic the white field-name text, which the extent-based profile must see through.
function pillPainter(
  x0: number,
  y0: number,
  w: number,
  h: number,
  { text = false }: { text?: boolean } = {},
): (x: number, y: number) => [number, number, number] {
  const r = h / 2;
  const cy = y0 + r;
  const leftC = x0 + r;
  const rightC = x0 + w - r;
  return (x, y) => {
    const px = x + 0.5;
    const dy = y + 0.5 - cy;
    if (Math.abs(dy) > r) return WHITE;
    let inside: boolean;
    if (px >= leftC && px <= rightC) {
      inside = true;
    } else {
      const cx = px < leftC ? leftC : rightC;
      const dx = px - cx;
      inside = dx * dx + dy * dy <= r * r;
    }
    if (!inside) return WHITE;
    // White text band through the vertical middle of the solid core (never near the caps),
    // so a real pill's interior is not uniformly red.
    if (text && Math.abs(dy) < r * 0.4 && px > leftC + r && px < rightC - r) {
      return WHITE;
    }
    return ERROR_RED;
  };
}

describe('isErrorRed', () => {
  it('matches Tableau error-pill red', () => {
    expect(isErrorRed(190, 40, 40)).toBe(true);
    expect(isErrorRed(210, 25, 30)).toBe(true);
    expect(isErrorRed(232, 72, 88)).toBe(true); // measured real pill body #E84858
  });

  it('rejects non-error colors', () => {
    expect(isErrorRed(255, 255, 255)).toBe(false); // white
    expect(isErrorRed(40, 40, 40)).toBe(false); // dark gray
    expect(isErrorRed(40, 90, 200)).toBe(false); // blue (the OTHER, valid pill)
    expect(isErrorRed(240, 150, 60)).toBe(false); // orange (G too high)
    expect(isErrorRed(150, 110, 110)).toBe(false); // muted maroon (not dominant enough)
  });
});

describe('scanForErrorRed — pill-shape detection', () => {
  it('flags a red field-pill capsule', () => {
    const image = makeImage(240, 120, pillPainter(40, 40, 120, 24));
    const scan = scanForErrorRed(image);

    expect(scan.pillFound).toBe(true);
    expect(scan.pill?.caps).toBe(2); // both rounded end-caps present
    expect(scan.pill?.fill).toBeGreaterThan(0.6); // solid body
    expect(scan.pill?.plateauHeight).toBe(24);
  });

  it('flags a pill even with white field-name text punched through the middle', () => {
    // The extent profile keys on the pill's top/bottom borders, so interior text does not hide it.
    const image = makeImage(240, 120, pillPainter(40, 40, 120, 24, { text: true }));
    const scan = scanForErrorRed(image);

    expect(scan.pillFound).toBe(true);
  });

  it('flags a short pill whose length shrank with the field name (length-invariant)', () => {
    const image = makeImage(240, 120, pillPainter(40, 40, 60, 24));
    const scan = scanForErrorRed(image);

    expect(scan.pillFound).toBe(true);
  });

  it('does NOT flag a square-cornered red rectangle (a bar, not a pill)', () => {
    const image = makeImage(240, 120, (x, y) =>
      x >= 40 && x < 160 && y >= 40 && y < 64 ? ERROR_RED : WHITE,
    );
    const scan = scanForErrorRed(image);

    expect(scan.redPixels).toBeGreaterThan(1000); // plenty of red...
    expect(scan.pillFound).toBe(false); // ...but square corners, so not a pill
  });

  it('does NOT flag a tall red bar (wrong orientation)', () => {
    const image = makeImage(240, 200, (x, y) =>
      x >= 40 && x < 64 && y >= 20 && y < 180 ? ERROR_RED : WHITE,
    );
    const scan = scanForErrorRed(image);

    expect(scan.pillFound).toBe(false);
  });

  it('does NOT flag red scattered thinly across the viz (marks)', () => {
    const image = makeImage(240, 135, (x, y) => ((x * 7 + y * 13) % 169 === 0 ? ERROR_RED : WHITE));
    const scan = scanForErrorRed(image);

    expect(scan.redPixels).toBeGreaterThan(100); // plenty of red pixels overall
    expect(scan.pillFound).toBe(false); // but no capsule-shaped component
  });

  it('flags a pill clipped at the image edge (only one rounded cap visible)', () => {
    // A pill running off the left edge: its left cap is cut to a square edge at x=0, so only
    // the right cap survives. caps === 1 must still flag — this exercises the `caps < 1` gate.
    const image = makeImage(200, 120, pillPainter(-30, 40, 120, 24));
    const scan = scanForErrorRed(image);

    expect(scan.pillFound).toBe(true);
    expect(scan.pill?.caps).toBe(1); // left cap clipped away, right cap intact
  });

  it('does NOT flag a thin horizontal red reference line (too short to be a pill body)', () => {
    // A 2px-tall red rule spanning the view: wide, but its plateau height is below the floor,
    // so the "red is overloaded" case (reference lines) does not trip the detector.
    const image = makeImage(240, 120, (x, y) =>
      x >= 20 && x < 220 && y >= 59 && y < 61 ? ERROR_RED : WHITE,
    );
    const scan = scanForErrorRed(image);

    expect(scan.redPixels).toBeGreaterThan(300); // plenty of red...
    expect(scan.pillFound).toBe(false); // ...but only 2px tall, no pill body
  });

  it('does NOT flag a solid red disc (a round mark peaks for one column, no flat body)', () => {
    const cx = 120;
    const cy = 60;
    const r = 18;
    const image = makeImage(240, 120, (x, y) => {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      return dx * dx + dy * dy <= r * r ? ERROR_RED : WHITE;
    });
    const scan = scanForErrorRed(image);

    expect(scan.pillFound).toBe(false);
  });

  it('reports zero red and no pill on a clean window', () => {
    const scan = scanForErrorRed(makeImage(200, 100, () => WHITE));
    expect(scan.redPixels).toBe(0);
    expect(scan.pillFound).toBe(false);
    expect(scan.pill).toBeNull();
  });
});

describe('decodePng', () => {
  it('maps decoded 8-bit RGB pixels onto DecodedImage', () => {
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

  it('scans a decoded PNG containing a red pill', () => {
    const decoded = decodePng(makePng(240, 120, pillPainter(40, 40, 120, 24)));
    const scan = scanForErrorRed(decoded!);
    expect(scan.pillFound).toBe(true);
  });

  it('returns null for a non-PNG or unsupported variant', () => {
    expect(decodePng(Buffer.from('not a png'))).toBeNull();
    expect(decodePng(Buffer.alloc(4))).toBeNull();
  });
});

// Regression fixtures captured from a live Tableau Desktop window (via take-all-screenshots),
// cropped at native resolution — real anti-aliased pill edges and real UI chrome, not synthetic
// capsules. These guard the two failure modes that actually happened in the field.
describe('scanForErrorRed — real captured windows', () => {
  it('flags the real red pill the old density scan missed (false-negative regression)', () => {
    // This exact window is what the previous density detector scored as "no dense red cluster
    // (29% red)" — a false negative. The cap-profile detector must flag its #E84858 pill.
    const scan = scanPngForErrorRed(fixture('real-window-red-pill.png'));

    expect(scan).not.toBeNull();
    expect(scan!.pillFound).toBe(true);
    expect(scan!.pill?.caps).toBeGreaterThanOrEqual(1);
    expect(scan!.pill?.plateauHeight).toBeGreaterThanOrEqual(8);
    expect(scan!.pill?.fill).toBeGreaterThan(0.6);
  });

  it('does NOT flag a real clean window (no pill among real chrome, gridlines, valid pills)', () => {
    // A genuinely clean capture: real toolbar/gridlines/valid (non-red) pills, no error pill.
    // Guards against false positives the synthetic negatives can't reproduce.
    const scan = scanPngForErrorRed(fixture('real-window-clean.png'));

    expect(scan).not.toBeNull();
    expect(scan!.pillFound).toBe(false);
  });
});
