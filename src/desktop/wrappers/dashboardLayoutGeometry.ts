import type { Element } from '@xmldom/xmldom';

type Bounds = [left: number, top: number, right: number, bottom: number];
const coordinates = ['x', 'y', 'w', 'h'] as const;
const minInt = -2147483648;
const maxInt = 2147483647;

function integer(value: string | null): number | undefined {
  if (!value?.trim() || !/^[+-]?\d+$/.test(value.trim())) return;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minInt && parsed <= maxInt ? parsed : undefined;
}

export function validZoneGeometry(zone: Element): boolean {
  for (const attribute of coordinates) {
    if (zone.hasAttribute(attribute) && integer(zone.getAttribute(attribute)) === undefined)
      return false;
  }
  return (['x', 'y'] as const).every((position, axis) => {
    const start = integer(zone.getAttribute(position));
    const length = integer(zone.getAttribute(axis === 0 ? 'w' : 'h'));
    return (
      start === undefined ||
      length === undefined ||
      (start + length >= minInt && start + length <= maxInt)
    );
  });
}

function bounds(zone: Element): Bounds | undefined {
  const values = coordinates.map((attribute) => integer(zone.getAttribute(attribute)));
  if (values.some((value) => value === undefined) || !validZoneGeometry(zone)) return;
  const [x, y, w, h] = values as number[];
  return [x, y, x + w, y + h];
}

function elements(element: Element): Element[] {
  return Array.from(element.childNodes).filter((node): node is Element => node.nodeType === 1);
}

function parentZone(zone: Element): Element | undefined {
  return zone.parentNode?.nodeType === 1 && (zone.parentNode as Element).tagName === 'zone'
    ? (zone.parentNode as Element)
    : undefined;
}

function isTrue(value: string | null): boolean {
  return value === 'true' || value === '1';
}

function hidden(zone: Element): boolean {
  for (let current: Element | undefined = zone; current; current = parentZone(current)) {
    if (isTrue(current.getAttribute('hidden-by-user'))) return true;
  }
  return false;
}

function strategyHidden(zone: Element): boolean {
  return hidden(zone) || isTrue(zone.getAttribute('hidden'));
}

function hasOverride(zone: Element): boolean {
  const strategy = zone.getAttribute('layout-strategy-id');
  const basicDefault =
    zone.getAttribute('type-v2') === 'layout-basic' && ['basic', 'flow'].includes(strategy ?? '');
  return (
    zone.hasAttribute('strategy-id') ||
    zone.hasAttribute('layout-horz') ||
    (strategy !== null && strategy !== 'flow' && !basicDefault)
  );
}

function isFlow(zone: Element): boolean {
  return (
    zone.getAttribute('type-v2') === 'layout-flow' &&
    ['vert', 'horz'].includes(zone.getAttribute('param') ?? '') &&
    !hasOverride(zone)
  );
}

function isBasic(zone: Element): boolean {
  return zone.getAttribute('type-v2') === 'layout-basic' && !hasOverride(zone);
}

export function canOmitDefaultStrategy(expected: Element, actual: Element): boolean {
  if (expected.tagName !== 'zone' || actual.hasAttribute('layout-strategy-id')) return false;
  const strategy = expected.getAttribute('layout-strategy-id');
  return (
    (isBasic(expected) && ['basic', 'flow'].includes(strategy ?? '')) ||
    (isFlow(expected) && strategy === 'flow')
  );
}

export function hasDesktopManagedGeometry(zone: Element): boolean {
  if (isTrue(zone.getAttribute('is-fixed')) || zone.hasAttribute('fixed-size')) return false;
  const parent = parentZone(zone);
  if (!parent || strategyHidden(parent)) return false;
  // BasicStrategy transforms every direct child, even a user-hidden one. Flow
  // skips hidden children; a hidden container's own descendants are not laid out.
  return isBasic(parent) || (isFlow(parent) && !hidden(zone));
}

function sameCoordinates(expected: Element, actual: Element): boolean {
  return coordinates.every((attribute) => {
    const a = expected.getAttribute(attribute);
    const b = actual.getAttribute(attribute);
    return (
      a === b ||
      (integer(a) !== undefined && integer(b) !== undefined && Math.abs(Number(a) - Number(b)) <= 1)
    );
  });
}

function equalBounds(a: Bounds, b: Bounds): boolean {
  return a.every((edge, index) => edge === b[index]);
}

function matchesBounds(expected: Bounds, actual: Bounds): boolean {
  return (
    Math.abs(expected[0] - actual[0]) <= 1 &&
    Math.abs(expected[1] - actual[1]) <= 1 &&
    Math.abs(expected[2] - expected[0] - (actual[2] - actual[0])) <= 1 &&
    Math.abs(expected[3] - expected[1] - (actual[3] - actual[1])) <= 1
  );
}

const sides = ['left', 'top', 'right', 'bottom'] as const;
const borderStyles = new Set([
  'solid',
  'dashed',
  'dotted',
  'hidden',
  'double',
  'groove',
  'ridge',
  'inset',
  'outset',
]);

function spacing(zone: Element): number[][] | undefined {
  const style = elements(zone).find((child) => child.tagName === 'zone-style');
  const formats = new Map(
    (style ? elements(style).filter((child) => child.tagName === 'format') : []).map((format) => [
      format.getAttribute('attr'),
      format.getAttribute('value'),
    ]),
  );
  const value = (name: string, side: string): string | null | undefined =>
    formats.get(`${name}-${side}`) ?? formats.get(name);
  const result = ['margin', 'border-width', 'padding'].map((name) =>
    sides.map((side) => {
      if (name === 'border-width' && !borderStyles.has(value('border-style', side) ?? 'none'))
        return 0;
      const raw = value(name, side);
      return raw === undefined ? 0 : integer(raw ?? null);
    }),
  );
  return result.some((group) => group.some((size) => size === undefined))
    ? undefined
    : (result as number[][]);
}

function owningLayout(zone: Element): { zones: Element; layout: Element } | undefined {
  let current: Element = zone;
  while (current.parentNode?.nodeType === 1) {
    current = current.parentNode as Element;
    if (current.tagName === 'zones' && current.parentNode?.nodeType === 1) {
      const layout = current.parentNode as Element;
      if (['dashboard', 'devicelayout'].includes(layout.tagName)) return { zones: current, layout };
    }
  }
  return;
}

function pixelUnits(zone: Element, amount: number, axis: number): number | undefined {
  const owner = owningLayout(zone);
  if (!owner) return;
  if (owner.zones.getAttribute('is-pixels') === 'true') return integer(String(amount));
  if (amount === 0) return 0;
  const size = elements(owner.layout).find((child) => child.tagName === 'size');
  const dimension = axis === 0 ? 'width' : 'height';
  const min = size && integer(size.getAttribute(`min${dimension}`));
  const max = size && integer(size.getAttribute(`max${dimension}`));
  if (min === undefined || min <= 0 || min !== max) return;
  const scaled = (100000 * amount) / min;
  const rounded = Math.trunc(scaled > 0 ? scaled + 0.5 : scaled - 0.5);
  return integer(String(rounded));
}

function clientBounds(expected: Element, actual: Element): Bounds | undefined {
  const rect = bounds(actual);
  const groups = spacing(expected);
  if (!rect || !groups) return;
  const content: Bounds = [...rect];
  for (const group of groups) {
    for (let side = 0; side < 4; side++) {
      const amount = group[side];
      // ZoneTransform rounds each margin/border/padding conversion separately.
      const rounded = pixelUnits(expected, amount, side % 2);
      // Native conversion saturates at int32; values requiring saturation or
      // overflowing intermediate rectangle arithmetic are outside this model.
      if (rounded === undefined) return;
      content[side] += (side < 2 ? 1 : -1) * rounded;
      if (integer(String(content[side])) === undefined) return;
    }
  }
  for (const axis of [0, 1]) {
    if (content[axis + 2] < content[axis]) {
      const center = Math.trunc((rect[axis] + rect[axis + 2]) / 2);
      content[axis] = center;
      content[axis + 2] = center;
    }
  }
  return content.every((edge) => integer(String(edge)) !== undefined) &&
    [0, 1].every((axis) => content[axis + 2] - content[axis] <= maxInt)
    ? content
    : undefined;
}

function extent(rects: Bounds[]): Bounds {
  return [
    Math.min(...rects.map((rect) => rect[0])),
    Math.min(...rects.map((rect) => rect[1])),
    Math.max(...rects.map((rect) => rect[2])),
    Math.max(...rects.map((rect) => rect[3])),
  ];
}

function normalizeBasic(before: Bounds[], target: Bounds): Bounds[] | undefined {
  const source = extent(before);
  if (equalBounds(source, target)) return before;
  const ratios = [0, 1].map((axis) => {
    const length = source[axis + 2] - source[axis];
    return length > 0 && length <= maxInt
      ? Math.fround(Math.fround(target[axis + 2] - target[axis]) / Math.fround(length))
      : undefined;
  });
  if (ratios.some((ratio) => ratio === undefined)) return;
  const rects = before.map(
    (rect) =>
      rect.map((edge, index) => {
        const axis = index % 2;
        // BasicStrategy stores ratios and each arithmetic operation in float32,
        // then truncates. Double arithmetic with an epsilon is not equivalent.
        return Math.trunc(
          Math.fround(
            Math.fround(Math.fround(edge - source[axis]) * ratios[axis]!) +
              Math.fround(target[axis]),
          ),
        );
      }) as Bounds,
  );
  if (rects.some((rect) => rect.some((edge) => integer(String(edge)) === undefined))) return;
  // Native ZoneFixup: expand outer edges, clamp overhangs, then repair overlap.
  const outer: Bounds = [target[2], target[3], target[0], target[1]];
  for (const rect of rects) {
    for (const axis of [0, 1]) {
      outer[axis] = Math.min(outer[axis], rect[axis]);
      outer[axis + 2] = Math.max(outer[axis + 2], rect[axis + 2]);
    }
  }
  for (const rect of rects) {
    for (const axis of [0, 1]) {
      if (rect[axis] === outer[axis]) rect[axis] = target[axis];
      if (rect[axis + 2] === outer[axis + 2]) rect[axis + 2] = target[axis + 2];
      rect[axis] = Math.max(rect[axis], target[axis]);
      rect[axis + 2] = Math.min(rect[axis + 2], target[axis + 2]);
    }
  }
  for (let i = 0; i < rects.length; i++) {
    const a = [...rects[i]];
    for (let j = i + 1; j < rects.length; j++) {
      const b = [...rects[j]];
      if (a[2] <= b[0] || a[0] >= b[2] || a[3] <= b[1] || a[1] >= b[3]) continue;
      for (const axis of [0, 1]) {
        const cross = axis === 0 ? 1 : 0;
        const larger = (): boolean =>
          rects[i][cross + 2] - rects[i][cross] > rects[j][cross + 2] - rects[j][cross];
        if (a[axis] <= b[axis] && b[axis] <= a[axis + 2] && b[axis + 2] > a[axis + 2]) {
          if (larger()) rects[j][axis] = a[axis + 2];
          else rects[i][axis + 2] = b[axis];
        }
      }
      for (const axis of [0, 1]) {
        const cross = axis === 0 ? 1 : 0;
        const larger = (): boolean =>
          rects[i][cross + 2] - rects[i][cross] > rects[j][cross + 2] - rects[j][cross];
        if (a[axis] <= b[axis + 2] && b[axis + 2] <= a[axis + 2] && b[axis] < a[axis]) {
          if (larger()) rects[j][axis + 2] = a[axis];
          else rects[i][axis] = b[axis + 2];
        }
      }
    }
  }
  return rects;
}

function singleHorizontalHeight(expected: Element, client: Bounds): number | undefined {
  const cache = elements(expected).find((child) => child.tagName === 'layout-cache');
  if (!cache || cache.getAttribute('type-h') !== 'fixed') return;
  if (cache.getAttribute('type-w') !== 'fixed' || isTrue(expected.getAttribute('is-fixed'))) return;
  const fixedWidth = integer(cache.getAttribute('fixed-size-w'));
  const fixed = integer(cache.getAttribute('fixed-size-h'));
  const insets = spacing(expected);
  if (fixed === undefined || fixed < 0 || fixedWidth === undefined || fixedWidth < 0 || !insets)
    return;
  const fixedPrimary = pixelUnits(expected, fixedWidth, 0);
  const primaryMargins = pixelUnits(expected, insets[0][0] + insets[0][2], 0);
  const primarySize =
    fixedPrimary === undefined || primaryMargins === undefined
      ? undefined
      : fixedPrimary + primaryMargins;
  // Only GrowZones invokes SetSingleHorizontal; ShrinkZones keeps full height.
  if (primarySize === undefined || primarySize > client[2] - client[0]) return;
  const height = pixelUnits(expected, fixed + insets[0][1] + insets[0][3], 1);
  if (height === undefined || height < 0) return;
  // FlowMetrics::SetSingleHorizontal fits one fixed-height child and gives it
  // the full primary width. Only submitted metrics authorize this exception;
  // an actual-only cache must not justify a corrupted cross-axis allocation.
  return Math.min(height, client[3] - client[1]);
}

export function layoutGeometryMatches(expected: Element, actual: Element): boolean {
  if (expected.tagName === 'zones')
    return (
      (expected.getAttribute('is-pixels') === 'true') ===
      (actual.getAttribute('is-pixels') === 'true')
    );
  if (expected.tagName !== 'zone') return true;
  if (
    !validZoneGeometry(expected) ||
    !validZoneGeometry(actual) ||
    hidden(expected) !== hidden(actual)
  )
    return false;
  for (const flag of ['is-fixed', 'hidden']) {
    if (isTrue(expected.getAttribute(flag)) !== isTrue(actual.getAttribute(flag))) return false;
  }
  for (const override of ['strategy-id', 'layout-horz']) {
    if (expected.getAttribute(override) !== actual.getAttribute(override)) return false;
  }
  if (
    expected.getAttribute('layout-strategy-id') !== actual.getAttribute('layout-strategy-id') &&
    !canOmitDefaultStrategy(expected, actual)
  )
    return false;
  const aSpacing = spacing(expected);
  const bSpacing = spacing(actual);
  if (JSON.stringify(aSpacing) !== JSON.stringify(bSpacing)) return false;
  const before = elements(expected).filter((child) => child.tagName === 'zone');
  const after = elements(actual).filter((child) => child.tagName === 'zone');
  if (before.length !== after.length) return false;
  if (before.length === 0 || (!isBasic(expected) && !isFlow(expected))) return true;
  if (
    sameCoordinates(expected, actual) &&
    before.every((child, index) => sameCoordinates(child, after[index]))
  )
    return true;
  if (strategyHidden(expected))
    return before.every((child, index) => sameCoordinates(child, after[index]));
  const client = clientBounds(expected, actual);
  if (!client) return false;
  if (client[2] <= client[0] || client[3] <= client[1])
    return before.every((child, index) => sameCoordinates(child, after[index]));
  const oldBounds = before.map(bounds);
  const newBounds = after.map(bounds);
  if (oldBounds.some((rect) => !rect) || newBounds.some((rect) => !rect)) return false;
  if (isBasic(expected)) {
    const normalized = normalizeBasic(oldBounds as Bounds[], client);
    return (
      !!normalized && normalized.every((rect, index) => matchesBounds(rect, newBounds[index]!))
    );
  }
  const indices = before.flatMap((child, index) => (hidden(child) ? [] : [index]));
  const visible = indices.map((index) => newBounds[index]!);
  const axis = expected.getAttribute('param') === 'horz' ? 0 : 1;
  const cross = axis === 0 ? 1 : 0;
  const fittedHeight =
    axis === 0 && visible.length === 1
      ? singleHorizontalHeight(before[indices[0]], client)
      : undefined;
  const crossSize = fittedHeight ?? client[cross + 2] - client[cross];
  const primaryUnchanged = indices.every((index) => {
    const old = oldBounds[index]!;
    const current = newBounds[index]!;
    return (
      Math.abs(old[axis] - current[axis]) <= 1 &&
      Math.abs(old[axis + 2] - old[axis] - (current[axis + 2] - current[axis])) <= 1
    );
  });
  // Without live text/worksheet metrics, changed primary allocations are only
  // verified when they fill the client. Retained allocations may leave a tail,
  // as fixed-only flows do. Native integer division leaves < childCount units.
  if (
    visible.length > 0 &&
    !primaryUnchanged &&
    Math.abs(visible[visible.length - 1][axis + 2] - client[axis + 2]) >
      Math.max(1, visible.length - 1)
  )
    return false;
  return visible.every(
    (rect, index) =>
      Math.abs(rect[cross] - client[cross]) <= 1 &&
      Math.abs(rect[cross + 2] - rect[cross] - crossSize) <= 1 &&
      Math.abs(rect[axis] - (index === 0 ? client[axis] : visible[index - 1][axis + 2])) <= 1 &&
      (fittedHeight === undefined || Math.abs(rect[2] - rect[0] - (client[2] - client[0])) <= 1) &&
      rect[axis + 2] <= client[axis + 2] + 1,
  );
}
