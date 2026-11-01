import { isObject, Json, Obj, object } from './compactYaml.js';

// ghidra-prep native TFL/TFLX samples, cross-checked with Tableau 2026.3
// Web authoring's "Node Colors" palette. See MIGRATION.json for provenance.
export const nativeCanvasColors = [
  '#3D7FA6',
  '#F6A035',
  '#86AF6A',
  '#CD677F',
  '#8BC2CA',
  '#845578',
  '#EFC637',
  '#499893',
  '#F37941',
  '#7E756D',
  '#B56252',
  '#F59A9A',
  '#9EB0A5',
  '#4F6980',
  '#62AEA1',
  '#C497B7',
  '#638B66',
  '#B9AA98',
  '#C3BB3D',
  '#7DC4AE',
] as const;
const palette = new Set<string>(nativeCanvasColors);

export function defaultCanvasColor(): Obj {
  return { hexCss: nativeCanvasColors[0], rgba: ['61', '127', '166', '1'] };
}

function channels(hex: string): number[] {
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)).concat(1);
}

function channel(value: Json): number {
  if (typeof value === 'number' || typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.0+)?$/.test(value)) return Number(value);
  return NaN;
}

/** Strict generation checks; acquisition and compatible native metadata stay unchanged. */
export function canvasColorErrors(document: Obj): string[] {
  const display = object(document.displaySettings ?? {}),
    layout = object(object(display.flowDisplaySettings ?? {}).flowNodeDisplaySettings ?? {}),
    nodes = object(object(document.flow).nodes),
    errors: string[] = [];
  const ids = new Set([...Object.keys(nodes), ...Object.keys(layout)]);
  for (const id of ids) {
    const path = 'displaySettings/flowDisplaySettings/flowNodeDisplaySettings/' + id + '/color',
      record = layout[id];
    if (!isObject(record) || !isObject(record.color)) {
      errors.push('CANVAS_COLOR_REQUIRED:' + path);
      continue;
    }
    const color = record.color,
      hex = color.hexCss;
    if (typeof hex !== 'string' || !palette.has(hex.toUpperCase())) {
      errors.push('CANVAS_COLOR_OUTSIDE_PALETTE:' + path);
      continue;
    }
    const rgba = color.rgba;
    if (
      !Array.isArray(rgba) ||
      rgba.length !== 4 ||
      !rgba.every((value, index) => channel(value) === channels(hex)[index])
    )
      errors.push('CANVAS_COLOR_RGBA_MISMATCH:' + path);
  }
  return errors;
}
