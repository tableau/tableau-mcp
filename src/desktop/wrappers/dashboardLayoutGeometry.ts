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

function validZoneGeometry(zone: Element): boolean {
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

function flowFullyModeled(parent: Element): boolean {
  const axis = parent.getAttribute('param') === 'horz' ? 0 : 1;
  return elements(parent)
    .filter((child) => child.tagName === 'zone' && !hidden(child))
    .every((child) => {
      const metric = primaryMetric(child, axis);
      return metric !== null && metric !== undefined;
    });
}

export function hasDesktopManagedGeometry(zone: Element): boolean {
  const parent = parentZone(zone);
  if (isTrue(zone.getAttribute('is-fixed')) || zone.hasAttribute('fixed-size')) {
    // Desktop rewrites a pin's w/h to fixed-size plus margins; the flow check judges the pins.
    return (
      zone.getAttribute('is-fixed') === 'true' &&
      !!parent &&
      !strategyHidden(parent) &&
      isFlow(parent) &&
      !hidden(zone) &&
      flowFullyModeled(parent)
    );
  }
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

function layoutSize(layout: Element): Element | undefined {
  const own = elements(layout).find((child) => child.tagName === 'size');
  if (own || layout.tagName !== 'devicelayout') return own;
  for (let parent = layout.parentNode; parent?.nodeType === 1; parent = parent.parentNode) {
    if ((parent as Element).tagName === 'dashboard')
      return elements(parent as Element).find((child) => child.tagName === 'size');
  }
  return;
}

function pixelUnits(zone: Element, amount: number, axis: number): number | undefined {
  const owner = owningLayout(zone);
  if (!owner) return;
  if (owner.zones.getAttribute('is-pixels') === 'true') return integer(String(amount));
  if (amount === 0) return 0;
  const size = layoutSize(owner.layout);
  if (size?.getAttribute('sizing-mode') === 'automatic') return;
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

function setEdge(rect: Bounds, edge: number, value: number): void {
  const opposite = (edge + 2) % 4;
  // Native Zone setters move the opposite edge when the requested edge crosses it.
  rect[(edge < 2 ? value <= rect[opposite] : value >= rect[opposite]) ? edge : opposite] = value;
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
      if (rect[axis] === outer[axis]) setEdge(rect, axis, target[axis]);
      if (rect[axis + 2] === outer[axis + 2]) setEdge(rect, axis + 2, target[axis + 2]);
      if (rect[axis] < target[axis]) setEdge(rect, axis, target[axis]);
      if (rect[axis + 2] > target[axis + 2]) setEdge(rect, axis + 2, target[axis + 2]);
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
          if (larger()) setEdge(rects[j], axis, a[axis + 2]);
          else setEdge(rects[i], axis + 2, b[axis]);
        }
      }
      for (const axis of [0, 1]) {
        const cross = axis === 0 ? 1 : 0;
        const larger = (): boolean =>
          rects[i][cross + 2] - rects[i][cross] > rects[j][cross + 2] - rects[j][cross];
        if (a[axis] <= b[axis + 2] && b[axis + 2] <= a[axis + 2] && b[axis] < a[axis]) {
          if (larger()) setEdge(rects[j], axis + 2, a[axis]);
          else setEdge(rects[i], axis, b[axis + 2]);
        }
      }
    }
  }
  return rects;
}

function isVisual(zone: Element): boolean {
  return (
    !!zone.getAttribute('name') &&
    (!zone.hasAttribute('type-v2') || zone.getAttribute('type-v2') === 'visual')
  );
}

type PrimaryMetric = { initial: number; unbounded: boolean; manual: boolean; fixed: number };

function primaryMetric(
  zone: Element,
  axis: number,
  readback = false,
): PrimaryMetric | null | undefined {
  const manual = zone.getAttribute('is-fixed') === 'true';
  const fixedMetric = (pixels: number): number | undefined => {
    const size = pixelUnits(zone, pixels, axis);
    const margins = spacing(zone)?.[0];
    if (size === undefined || !margins) return;
    const converted = pixelUnits(zone, margins[axis] + margins[axis + 2], axis);
    if (converted === undefined) return;
    const total = size + converted;
    return total >= 0 && total <= maxInt ? total : undefined;
  };
  if (manual) {
    const request = zone.hasAttribute('fixed-size') ? integer(zone.getAttribute('fixed-size')) : 0;
    if (request === undefined || request < 0) return null;
    const fixed = request > 0 ? fixedMetric(request) : 0;
    if (fixed === undefined) return null;
    if (fixed > 0) return { initial: fixed, unbounded: false, manual, fixed };
  }
  if (zone.getAttribute('type-v2') === 'empty') {
    // Empty zones have no layout-info provider; FlowInfo uses the native 32px default.
    const initial = pixelUnits(zone, 32, axis);
    return initial === undefined ? undefined : { initial, unbounded: !manual, manual, fixed: 0 };
  }
  if (!isVisual(zone)) return;
  const cache = elements(zone).find((child) => child.tagName === 'layout-cache');
  if (!cache) return;
  const dimension = axis === 0 ? 'width' : 'height';
  const suffix = axis === 0 ? 'w' : 'h';
  const type = cache.getAttribute(`type-${suffix}`);
  if (type !== 'fixed' && type !== 'scalable') return null;
  const raw = cache.getAttribute(type === 'fixed' ? `fixed-size-${suffix}` : `min${dimension}`);
  // Parser-default scalable minima are zero; the formatter omits 300px cache values.
  const pixels = raw === null ? (readback || type === 'fixed' ? 300 : 0) : integer(raw);
  if (pixels === undefined || pixels < 0) return null;
  const initial = type === 'fixed' ? fixedMetric(pixels) : pixelUnits(zone, pixels, axis);
  if (initial === undefined) return null;
  return initial < 0 || initial > maxInt
    ? null
    : {
        initial,
        unbounded: type === 'scalable' && cache.getAttribute(`has-max-size-${suffix}`) !== 'true',
        manual,
        fixed: type === 'fixed' ? initial : 0,
      };
}

function resolvedPrimaryMetric(
  zone: Element,
  axis: number,
  readback: PrimaryMetric | null | undefined,
): PrimaryMetric | null | undefined {
  const metric = primaryMetric(zone, axis);
  const cache = elements(zone).find((child) => child.tagName === 'layout-cache');
  const suffix = axis === 0 ? 'w' : 'h';
  return metric &&
    metric.fixed === 0 &&
    cache?.getAttribute(`type-${suffix}`) === 'scalable' &&
    !cache.hasAttribute(axis === 0 ? 'minwidth' : 'minheight') &&
    readback &&
    readback.fixed === 0 &&
    readback.manual === metric.manual
    ? readback
    : metric;
}

function waterFill(values: number[], capacity: number): { cap: number; used: number } {
  const sorted = [...values].sort((a, b) => a - b);
  let used = 0;
  let cap = 0;
  for (let index = 0; index < sorted.length; index++) {
    cap = Math.floor((capacity - used) / (sorted.length - index));
    if (sorted[index] > cap) {
      used += (sorted.length - index) * cap;
      break;
    }
    used += sorted[index];
  }
  return { cap, used };
}

function primaryAllocationMatches(
  expected: Element[],
  actual: Element[],
  sizes: number[],
  length: number,
  axis: number,
  fillsClient: boolean,
): boolean | undefined {
  const readback = actual.map((zone) => primaryMetric(zone, axis, true));
  const metrics = expected.map((zone, index) => resolvedPrimaryMetric(zone, axis, readback[index]));
  if (metrics.includes(null)) return false;
  const hasManual = expected.some((zone) => zone.getAttribute('is-fixed') === 'true');
  if (
    expected.some(
      (zone, index) => zone.getAttribute('is-fixed') === 'true' && metrics[index] === undefined,
    )
  )
    return false;
  const emptyIndices = expected.flatMap((zone, index) =>
    zone.getAttribute('type-v2') === 'empty' && zone.getAttribute('is-fixed') !== 'true'
      ? [index]
      : [],
  );
  const firstEmpty = emptyIndices.find((index) => index !== sizes.length - 1);
  if (firstEmpty !== undefined) {
    for (const index of emptyIndices) {
      const difference = sizes[index] - sizes[firstEmpty];
      if (
        index === sizes.length - 1
          ? difference < -2 || (!hasManual && difference > sizes.length + 1)
          : Math.abs(difference) > 2
      )
        return false;
    }
  }
  if (emptyIndices.length === sizes.length && metrics.some((metric) => metric === undefined)) {
    const share = Math.floor(length / sizes.length);
    const remainder = length % sizes.length;
    return [0, remainder].some((tail) =>
      sizes.every(
        (size, index) => Math.abs(size - share - (index === sizes.length - 1 ? tail : 0)) <= 1,
      ),
    );
  }
  const smallest = pixelUnits(expected[0], 32, axis);
  if (hasManual && smallest === undefined) return false;
  const manual = metrics.flatMap((metric) => (metric?.manual ? [metric] : []));
  const budget = Math.max(
    length - (sizes.length - manual.length) * (smallest ?? 0),
    Math.floor(length / sizes.length) * manual.length,
  );
  const fixed = waterFill(
    manual.map((metric) => metric.fixed),
    budget,
  );
  const manualShortfall = manual.reduce(
    (sum, metric) => sum + Math.max(0, metric.initial - Math.min(metric.fixed, fixed.cap)),
    0,
  );
  const automaticCount = sizes.length - manual.length;
  const minimumShare = automaticCount > 0 ? Math.floor((length - fixed.used) / automaticCount) : 0;
  let canGrow = true;
  let canShrink = fillsClient;
  for (const candidates of [metrics, readback]) {
    if (candidates.includes(null)) return false;
    if (
      !fillsClient &&
      (candidates.some((metric) => metric?.unbounded) || (axis === 0 && sizes.length === 1))
    )
      canGrow = false;
    if (candidates.reduce((sum, metric) => sum + (metric?.initial ?? 0), 0) > length)
      canGrow = false;
    const hasCappedAutomatic = candidates.some(
      (metric, index) => metric && !metric.manual && sizes[index] + 1 < metric.initial,
    );
    let tailAllowance = sizes.length + (hasCappedAutomatic ? 0 : manualShortfall);
    let minimumExtra = 0;
    let maximumExtra = maxInt;
    let minimumCap = minimumShare;
    let maximumCap = maxInt;
    for (const [index, metric] of candidates.entries()) {
      if (!metric?.manual) {
        const remainder = index === sizes.length - 1 ? tailAllowance : 0;
        minimumCap = Math.max(minimumCap, sizes[index] - remainder - 1);
        if (metric && metric.initial > sizes[index] + 1)
          maximumCap = Math.min(maximumCap, sizes[index] + 1);
      }
      if (!metric) continue;
      const grown = axis === 0 && sizes.length === 1 && !metric.unbounded ? length : metric.initial;
      if (sizes[index] + 1 < grown || (!metric.unbounded && Math.abs(sizes[index] - grown) > 1))
        canGrow = false;
      if (metric.unbounded) {
        minimumExtra = Math.max(minimumExtra, sizes[index] - metric.initial - 1);
        maximumExtra = Math.min(maximumExtra, sizes[index] - metric.initial + 1);
      }
    }
    if (hasCappedAutomatic) {
      // Only automatic tiles that can reach the shared cap contribute integer rounding.
      const possibleCapped = candidates.filter(
        (metric, index) => !metric?.manual && sizes[index] + 1 >= minimumCap,
      ).length;
      tailAllowance = Math.max(1, possibleCapped);
      if (!candidates[sizes.length - 1]?.manual)
        minimumCap = Math.max(minimumCap, sizes[sizes.length - 1] - tailAllowance);
    }
    for (const [index, metric] of candidates.entries()) {
      if (!metric) continue;
      const shrunk = metric.manual ? Math.min(metric.fixed, fixed.cap) : metric.initial;
      const minimum = metric.manual ? shrunk : Math.min(shrunk, minimumShare);
      const maximum = shrunk + (index === sizes.length - 1 ? tailAllowance : 1);
      if (sizes[index] + 1 < minimum || sizes[index] > maximum) canShrink = false;
    }
    if (minimumExtra > maximumExtra) canGrow = false;
    if (minimumCap > maximumCap) canShrink = false;
  }
  if (!canGrow && !canShrink) return false;
  if (metrics.some((metric) => metric === undefined)) return;
  const known = metrics as PrimaryMetric[];
  const total = known.reduce((sum, metric) => sum + metric.initial, 0);
  if (total > maxInt) return false;
  let allocated: number[];
  if (total <= length) {
    const unbounded = known.filter((metric) => metric.unbounded).length;
    const extra = unbounded > 0 ? Math.floor((length - total) / unbounded) : 0;
    allocated = known.map((metric) => metric.initial + (metric.unbounded ? extra : 0));
    if (axis === 0 && known.length === 1 && !known[0].unbounded) allocated[0] = length;
  } else {
    const automatic = waterFill(
      known.filter((metric) => !metric.manual).map((metric) => metric.initial),
      length - fixed.used,
    );
    allocated = known.map((metric) =>
      metric.manual ? Math.min(metric.fixed, fixed.cap) : Math.min(metric.initial, automatic.cap),
    );
    allocated[allocated.length - 1] += length - allocated.reduce((sum, size) => sum + size, 0);
  }
  return allocated.every((size, index) => Math.abs(size - sizes[index]) <= 1);
}

function singleHorizontalHeight(
  expected: Element,
  actual: Element,
  client: Bounds,
): number | undefined {
  if (!isVisual(expected)) return;
  const cache = elements(expected).find((child) => child.tagName === 'layout-cache');
  if (!cache || cache.getAttribute('type-h') !== 'fixed') return;
  if (isTrue(expected.getAttribute('is-fixed'))) return;
  const primary = resolvedPrimaryMetric(expected, 0, primaryMetric(actual, 0, true));
  const fixed = cache.hasAttribute('fixed-size-h')
    ? integer(cache.getAttribute('fixed-size-h'))
    : 300;
  const insets = spacing(expected);
  if (fixed === undefined || fixed < 0 || !primary || primary.unbounded || !insets) return;
  if (primary.initial > client[2] - client[0]) return;
  const height = pixelUnits(expected, fixed + insets[0][1] + insets[0][3], 1);
  if (height === undefined || height < 0) return;
  return Math.min(height, client[3] - client[1]);
}

/** The flow's span in px: Desktop's units are out of 100000 unless the zones are is-pixels. */
function containerPixels(flow: Element, span: number, axis: number): number | undefined {
  const owner = owningLayout(flow);
  if (!owner) return;
  if (owner.zones.getAttribute('is-pixels') === 'true') return span;
  const size = layoutSize(owner.layout);
  if (size?.getAttribute('sizing-mode') === 'automatic') return;
  const dimension = axis === 0 ? 'width' : 'height';
  const min = size && integer(size.getAttribute(`min${dimension}`));
  if (!min || min <= 0 || min !== integer(size.getAttribute(`max${dimension}`))) return;
  return Math.round((span * min) / 100000);
}

function spanText(flow: Element, span: number, axis: number): string {
  if (owningLayout(flow)?.zones.getAttribute('is-pixels') === 'true') return `${span}px`;
  const px = containerPixels(flow, span, axis);
  return px === undefined ? `${span} units` : `${span} units (${px}px)`;
}

/** The pins that make the submitted split stick, or '' unless every value in them is known. */
function pinFix(
  flow: Element,
  before: Element[],
  after: Element[],
  submitted: number[],
  span: number,
  axis: number,
): string {
  const suffix = axis === 0 ? 'w' : 'h';
  const pinned = before.map((zone) => zone.getAttribute('is-fixed') === 'true');
  const sizedByContent = before.some(
    (_, index) =>
      !pinned[index] &&
      elements(after[index])
        .find((child) => child.tagName === 'layout-cache')
        ?.getAttribute(`type-${suffix}`) === 'fixed',
  );
  const px = containerPixels(flow, span, axis);
  if (!sizedByContent || px === undefined || !flow.getAttribute('id')) return '';
  const ids = before.map((zone) => zone.getAttribute('id'));
  if (ids.some((id) => !id)) return '';
  const margins: number[] = [];
  for (const zone of before) {
    const group = spacing(zone)?.[0];
    if (!group) return '';
    margins.push(group[axis] + group[axis + 2]);
  }
  const requested = before.map((zone) => integer(zone.getAttribute('fixed-size')));
  const open = before.flatMap((_, index) => (pinned[index] ? [] : [index]));
  const weight = open.reduce((sum, index) => sum + submitted[index], 0);
  // A pinned child's footprint is its fixed-size plus its margins; the rest split what remains.
  let remaining = px;
  for (const [index, isPinned] of pinned.entries()) {
    if (!isPinned) continue;
    if (requested[index] === undefined) return '';
    remaining -= requested[index] + margins[index];
  }
  if (!(weight > 0) || !(remaining > 0)) return '';
  const pool = remaining;
  const sizes = before.map((_, index) => {
    if (pinned[index]) return requested[index]!;
    const footprint =
      index === open[open.length - 1] ? remaining : Math.round((submitted[index] / weight) * pool);
    remaining -= footprint;
    return footprint - margins[index];
  });
  if (sizes.some((size) => !(size >= 1))) return '';
  const list = ids.map((id, index) => `zone ${id} is-fixed='true' fixed-size='${sizes[index]}'`);
  return `Desktop sized unpinned zones to their content. FIX: pin every child of zone ${flow.getAttribute('id')}: ${list.join(', ')} (px; each child's margins add to its fixed-size, and the total fills the ${px}px container)`;
}

export function zoneLabel(zone: Element): string {
  const id = zone.getAttribute('id');
  const name = zone.getAttribute('name') || zone.getAttribute('param');
  return `zone ${id ?? '(no id)'}${name ? ` (${quoted(name)})` : ''}`;
}

const REASON_VALUE_MAX = 80;
// Room for a FIX sentence that lists every child of a flow.
const REASON_MAX = 1000;

function clipText(value: string, max = REASON_VALUE_MAX): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** JSON-quoted and clipped, so a quote or newline in the value cannot break the one-line reason. */
export function quoted(value: string): string {
  return JSON.stringify(clipText(value));
}

export function capReason(reason: string): string {
  return clipText(reason, REASON_MAX);
}

function boundsText(rect: Bounds | undefined): string {
  return rect
    ? `x=${rect[0]} y=${rect[1]} w=${rect[2] - rect[0]} h=${rect[3] - rect[1]}`
    : 'invalid';
}

/** First way the readback layout differs from the submitted layout, or undefined when it matches. */
export function layoutGeometryDifference(expected: Element, actual: Element): string | undefined {
  if (expected.tagName === 'zones')
    return (expected.getAttribute('is-pixels') === 'true') !==
      (actual.getAttribute('is-pixels') === 'true')
      ? `the zones' is-pixels is ${describeAttribute(actual, 'is-pixels')} in Desktop, ${describeAttribute(expected, 'is-pixels')} submitted`
      : undefined;
  if (expected.tagName !== 'zone') return;
  const label = zoneLabel(expected);
  if (!validZoneGeometry(expected) || !validZoneGeometry(actual))
    return `${label}: x, y, w or h is not a valid integer`;
  if (hidden(expected) !== hidden(actual))
    return `${label}: hidden-by-user is ${hidden(actual)} in Desktop, ${hidden(expected)} submitted`;
  for (const flag of ['is-fixed', 'hidden']) {
    if (isTrue(expected.getAttribute(flag)) !== isTrue(actual.getAttribute(flag)))
      return `${label}: ${flag} is ${isTrue(actual.getAttribute(flag))} in Desktop, ${isTrue(expected.getAttribute(flag))} submitted`;
  }
  for (const override of ['strategy-id', 'layout-horz']) {
    if (expected.getAttribute(override) !== actual.getAttribute(override))
      return `${label}: ${override} is ${describeAttribute(actual, override)} in Desktop, ${describeAttribute(expected, override)} submitted`;
  }
  if (
    expected.getAttribute('layout-strategy-id') !== actual.getAttribute('layout-strategy-id') &&
    !canOmitDefaultStrategy(expected, actual)
  )
    return `${label}: layout-strategy-id is ${describeAttribute(actual, 'layout-strategy-id')} in Desktop, ${describeAttribute(expected, 'layout-strategy-id')} submitted`;
  const aSpacing = spacing(expected);
  const bSpacing = spacing(actual);
  if (JSON.stringify(aSpacing) !== JSON.stringify(bSpacing))
    return `${label}: margins, padding or border differ between Desktop and the submission`;
  const before = elements(expected).filter((child) => child.tagName === 'zone');
  const after = elements(actual).filter((child) => child.tagName === 'zone');
  if (before.length !== after.length)
    return `${label} has ${after.length} child zones in Desktop, ${before.length} submitted`;
  if (before.length === 0 || (!isBasic(expected) && !isFlow(expected))) return;
  if (
    sameCoordinates(expected, actual) &&
    before.every((child, index) => sameCoordinates(child, after[index]))
  )
    return;
  if (strategyHidden(expected)) {
    const moved = before.findIndex((child, index) => !sameCoordinates(child, after[index]));
    return moved < 0
      ? undefined
      : `${zoneLabel(before[moved])}: position is ${boundsText(bounds(after[moved]))} in Desktop, ${boundsText(bounds(before[moved]))} submitted`;
  }
  const client = clientBounds(expected, actual);
  if (!client) return `${label}: Desktop's layout area for its children could not be determined`;
  if (client[2] <= client[0] || client[3] <= client[1]) {
    const moved = before.findIndex((child, index) => !sameCoordinates(child, after[index]));
    return moved < 0
      ? undefined
      : `${zoneLabel(before[moved])}: position is ${boundsText(bounds(after[moved]))} in Desktop, ${boundsText(bounds(before[moved]))} submitted`;
  }
  const oldBounds = before.map(bounds);
  const newBounds = after.map(bounds);
  const invalid = before.findIndex((_, index) => !oldBounds[index] || !newBounds[index]);
  if (invalid >= 0)
    return `${zoneLabel(before[invalid])}: x, y, w or h is missing or not a valid integer`;
  if (isBasic(expected)) {
    const normalized = normalizeBasic(oldBounds as Bounds[], client);
    if (!normalized)
      return `${label}: the submitted child zones cannot be fit into the layout area`;
    const off = normalized.findIndex((rect, index) => !matchesBounds(rect, newBounds[index]!));
    return off < 0
      ? undefined
      : `${zoneLabel(before[off])}: position is ${boundsText(newBounds[off])} in Desktop, ${boundsText(normalized[off])} expected after normalizing the submitted layout`;
  }
  const indices = before.flatMap((child, index) => (hidden(child) ? [] : [index]));
  const visible = indices.map((index) => newBounds[index]!);
  const axis = expected.getAttribute('param') === 'horz' ? 0 : 1;
  const cross = axis === 0 ? 1 : 0;
  const fittedHeight =
    axis === 0 && visible.length === 1
      ? singleHorizontalHeight(before[indices[0]], after[indices[0]], client)
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
  const fillsClient =
    visible.length === 0 ||
    Math.abs(visible[visible.length - 1][axis + 2] - client[axis + 2]) <=
      Math.max(1, visible.length - 1);
  const primaryAllocation =
    visible.length > 0
      ? primaryAllocationMatches(
          indices.map((index) => before[index]),
          indices.map((index) => after[index]),
          visible.map((rect) => rect[axis + 2] - rect[axis]),
          client[axis + 2] - client[axis],
          axis,
          fillsClient,
        )
      : undefined;
  const axisName = axis === 0 ? 'width' : 'height';
  const sizes = (rects: Array<Bounds | undefined>): string =>
    indices.map((index) => rects[index]![axis + 2] - rects[index]![axis]).join(', ');
  const span = client[axis + 2] - client[axis];
  const withFix = (reason: string): string => {
    const text = pinFix(
      expected,
      indices.map((index) => before[index]),
      indices.map((index) => after[index]),
      indices.map((index) => oldBounds[index]![axis + 2] - oldBounds[index]![axis]),
      span,
      axis,
    );
    // capReason would cut a FIX in the middle, so a FIX that does not fit is left out.
    return text && `${reason}. ${text}`.length <= REASON_MAX ? `${reason}. ${text}` : reason;
  };
  if (primaryAllocation === false)
    return withFix(
      `${label}: child ${axisName}s are [${sizes(newBounds)}] in Desktop, which does not match the allocation of the submitted [${sizes(oldBounds)}] in ${spanText(expected, span, axis)}`,
    );
  // With incomplete metrics, changed allocations must fill the client except for
  // integer remainders. Unchanged fixed-only flows may retain trailing space.
  if (visible.length > 0 && !primaryUnchanged && primaryAllocation !== true && !fillsClient)
    return withFix(
      `${label}: child ${axisName}s are [${sizes(newBounds)}] in Desktop and do not fill the ${spanText(expected, span, axis)} available`,
    );
  const off = visible.findIndex(
    (rect, index) =>
      !(
        Math.abs(rect[cross] - client[cross]) <= 1 &&
        Math.abs(rect[cross + 2] - rect[cross] - crossSize) <= 1 &&
        Math.abs(rect[axis] - (index === 0 ? client[axis] : visible[index - 1][axis + 2])) <= 1 &&
        (fittedHeight === undefined ||
          Math.abs(rect[2] - rect[0] - (client[2] - client[0])) <= 1) &&
        rect[axis + 2] <= client[axis + 2] + 1
      ),
  );
  return off < 0
    ? undefined
    : `${zoneLabel(before[indices[off]])}: position is ${boundsText(visible[off])} in Desktop, which does not tile the ${boundsText(client)} layout area`;
}

function describeAttribute(element: Element, name: string): string {
  const value = element.getAttribute(name);
  return value === null || !element.hasAttribute(name) ? 'missing' : quoted(value);
}
