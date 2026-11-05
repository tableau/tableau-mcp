import { canvasColorErrors, defaultCanvasColor, nativeCanvasColors } from './canvasColors.js';
import { Obj } from './compactYaml.js';

function document(color: unknown): Obj {
  return {
    flow: { nodes: { node: { columnName: 'color', expression: "'#000000'" } } },
    displaySettings: {
      flowDisplaySettings: { flowNodeDisplaySettings: { node: { color: color as Obj } } },
    },
  };
}

describe('native Prep canvas color contract', () => {
  it.each(nativeCanvasColors)(
    'accepts native palette color %s with matching string or numeric RGBA',
    (hex) => {
      const rgba = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)).concat(1);
      for (const channels of [rgba, rgba.map(String)]) {
        const doc = document({ hexCss: hex.toLowerCase(), rgba: channels }),
          before = structuredClone(doc);
        expect(canvasColorErrors(doc)).toEqual([]);
        expect(doc).toEqual(before);
      }
    },
  );
  it.each([
    ['missing', undefined, 'CANVAS_COLOR_REQUIRED'],
    ['null', null, 'CANVAS_COLOR_REQUIRED'],
    ['wrong type', '#3D7FA6', 'CANVAS_COLOR_REQUIRED'],
    [
      'valid CSS outside native palette',
      { hexCss: '#000000', rgba: [0, 0, 0, 1] },
      'CANVAS_COLOR_OUTSIDE_PALETTE',
    ],
    ['missing hex', { rgba: [61, 127, 166, 1] }, 'CANVAS_COLOR_OUTSIDE_PALETTE'],
    ['wrong channel', { hexCss: '#3D7FA6', rgba: [62, 127, 166, 1] }, 'CANVAS_COLOR_RGBA_MISMATCH'],
    ['wrong alpha', { hexCss: '#3D7FA6', rgba: [61, 127, 166, 0.5] }, 'CANVAS_COLOR_RGBA_MISMATCH'],
    ['wrong length', { hexCss: '#3D7FA6', rgba: [61, 127, 166] }, 'CANVAS_COLOR_RGBA_MISMATCH'],
    [
      'hex-encoded channel',
      { hexCss: '#3D7FA6', rgba: ['0x3d', '127', '166', '1'] },
      'CANVAS_COLOR_RGBA_MISMATCH',
    ],
    ['absent channels', { hexCss: '#3D7FA6' }, 'CANVAS_COLOR_RGBA_MISMATCH'],
  ])('rejects %s without repairing the source', (_name, color, code) => {
    const doc = document(color),
      before = structuredClone(doc);
    expect(canvasColorErrors(doc)).toHaveLength(1);
    expect(canvasColorErrors(doc)[0]).toContain(code);
    expect(doc).toEqual(before);
  });
  it('requires color for every visible node, while unrelated field colors are untouched', () => {
    const doc = document(defaultCanvasColor());
    expect(canvasColorErrors(doc)).toEqual([]);
    doc.displaySettings = {};
    expect(canvasColorErrors(doc)[0]).toContain('CANVAS_COLOR_REQUIRED');
    expect(nativeCanvasColors).toHaveLength(20);
    expect(new Set(nativeCanvasColors).size).toBe(20);
  });
});
