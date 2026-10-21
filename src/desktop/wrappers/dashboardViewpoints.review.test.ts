import { createDashboardReadbackVerifier } from './dashboardViewpoints.js';

type Rect = [x: number, y: number, width: number, height: number];
type Axis = 'vert' | 'horz';

const full: Rect = [0, 0, 100000, 100000];
const fixedSize = 'minwidth="1000" maxwidth="1000" minheight="1000" maxheight="1000"';
const wideSize = 'minwidth="1000" maxwidth="1000" minheight="800" maxheight="800"';

function style(margin = 0): string {
  return `<zone-style><format attr="margin" value="${margin}"/><format attr="padding" value="0"/><format attr="border-width" value="0"/></zone-style>`;
}

function zone(id: number, rect: Rect, attributes: string, content = ''): string {
  const [x, y, w, h] = rect;
  return `<zone id="${id}" x="${x}" y="${y}" w="${w}" h="${h}" ${attributes}>${content}</zone>`;
}

function cell(offset: number, size: number, axis: Axis): Rect {
  return axis === 'vert' ? [0, offset, 100000, size] : [offset, 0, size, 100000];
}

function flow(content: string, axis: Axis = 'vert', rect: Rect = full, id = 1): string {
  return zone(id, rect, `type-v2="layout-flow" param="${axis}"`, content + style());
}

function workbook(zones: string, size = fixedSize, devices = ''): string {
  const worksheet = (zones + devices).includes('name="A"');
  return `<workbook><worksheets>${worksheet ? '<worksheet name="A"/>' : ''}</worksheets>
    <dashboards><dashboard name="D"><size ${size}/><zones>${zones}</zones>${devices}</dashboard></dashboards>
    <windows><window class="dashboard" name="D"><viewpoints>${worksheet ? '<viewpoint name="A"/>' : ''}</viewpoints></window></windows></workbook>`;
}

function verify(expected: string, actual: string): boolean {
  return createDashboardReadbackVerifier(expected, 'D')(actual);
}

describe.each<Axis>(['vert', 'horz'])('%s flow with unchanged primary geometry', (axis) => {
  function pair(
    kind: 'empty' | 'scalable' | 'fixed' | 'text',
    sizes: [number, number],
    crossInset: number,
  ): string {
    const visual = kind === 'scalable' || kind === 'fixed';
    const cache =
      kind === 'scalable'
        ? '<layout-cache type-w="scalable" minwidth="100" has-max-size-w="false" type-h="scalable" minheight="100" has-max-size-h="false"/>'
        : '<layout-cache type-w="fixed" fixed-size-w="100" type-h="fixed" fixed-size-h="100"/>';
    const cells = sizes.map((size, index) => {
      const rect = cell(index === 0 ? 0 : sizes[0], size, axis);
      rect[axis === 'vert' ? 0 : 1] = crossInset;
      rect[axis === 'vert' ? 2 : 3] = 100000 - 2 * crossInset;
      return zone(
        index + 2,
        rect,
        visual ? `type-v2="visual" name="${index === 0 ? 'A' : 'B'}"` : `type-v2="${kind}"`,
        visual ? cache : kind === 'text' ? '<formatted-text><run>Title</run></formatted-text>' : '',
      );
    });
    const xml = workbook(flow(cells.join(''), axis));
    return visual
      ? xml
          .replace('<worksheets>', '<worksheets><worksheet name="B"/>')
          .replace('<viewpoints>', '<viewpoints><viewpoint name="B"/>')
      : xml;
  }

  it.each(['empty', 'scalable'] as const)(
    'rejects retained unequal %s allocations when only the cross axis reflows',
    (kind) => {
      const expected = pair(kind, [99000, 1000], 1000);
      expect(verify(expected, expected)).toBe(true);
      expect(verify(expected, pair(kind, [50000, 50000], 0))).toBe(true);
      expect(verify(expected, pair(kind, [99000, 1000], 0))).toBe(false);
    },
  );

  it('retains native fixed-cache trailing space during cross-axis reflow', () => {
    const expected = pair('fixed', [10000, 10000], 1000);
    expect(verify(expected, expected)).toBe(true);
    expect(verify(expected, pair('fixed', [10000, 10000], 0))).toBe(true);
  });

  it('retains trailing space for unknown text metrics during cross-axis reflow', () => {
    const expected = pair('text', [10000, 10000], 1000);
    expect(verify(expected, expected)).toBe(true);
    expect(verify(expected, pair('text', [10000, 10000], 0))).toBe(true);
  });
});

describe('ordered Basic edge setters', () => {
  function basic(rects: Rect[]): string {
    return workbook(
      zone(
        1,
        full,
        'type-v2="layout-basic"',
        rects.map((rect, index) => zone(index + 2, rect, 'type-v2="empty"')).join('') + style(),
      ),
    );
  }

  const native: Rect[] = [
    [30000, 80000, 30000, 20000],
    [0, 0, 40000, 40000],
    [40000, 40000, 60000, 60000],
  ];

  it.each([
    {
      setter: 'SetX2',
      before: [
        [31000, 41000, 30000, 60000],
        [1000, 1000, 40000, 80000],
        [31000, 41000, 70000, 60000],
      ] as Rect[],
      after: native,
    },
    {
      setter: 'SetY',
      before: [
        [11000, 51000, 60000, 80000],
        [31000, 71000, 100000, 70000],
        [61000, 41000, 90000, 40000],
      ] as Rect[],
      after: [
        [0, 10000, 35714, 30000],
        [42857, 40000, 42857, 60000],
        [35714, 0, 64286, 40000],
      ] as Rect[],
    },
    {
      setter: 'SetY2',
      before: [
        [61000, 11000, 50000, 100000],
        [41000, 21000, 60000, 20000],
        [11000, 11000, 70000, 20000],
        [31000, 21000, 20000, 60000],
      ] as Rect[],
      after: [
        [50000, 0, 50000, 100000],
        [40000, 10000, 10000, 20000],
        [0, 0, 50000, 20000],
        [20000, 20000, 20000, 50000],
      ] as Rect[],
    },
    {
      setter: 'SetX',
      before: [
        [1000, 11000, 70000, 50000],
        [61000, 31000, 60000, 100000],
        [31000, 41000, 10000, 70000],
        [61000, 71000, 100000, 100000],
        [11000, 11000, 50000, 20000],
        [21000, 21000, 70000, 60000],
      ] as Rect[],
      after: [
        [0, 0, 12500, 6250],
        [37500, 12500, 18750, 31250],
        [18750, 43750, 6250, 18750],
        [37500, 37500, 62500, 62500],
        [6250, 0, 31250, 12500],
        [12500, 12500, 25000, 25000],
      ] as Rect[],
    },
  ])(
    'accepts native ordered repair when $setter crosses the live opposite edge',
    ({ before, after }) => {
      const expected = basic(before);
      expect(verify(expected, expected)).toBe(true);
      expect(verify(expected, basic(after))).toBe(true);
    },
  );

  it('retains canonical repaired geometry once the child union equals the client', () => {
    const expected = basic(native);
    expect(verify(expected, expected)).toBe(true);
    expect(verify(expected, basic([[31000, 80000, 30000, 20000], native[1], native[2]]))).toBe(
      false,
    );
  });
});

describe.each<Axis>(['vert', 'horz'])('partial %s non-growing metrics', (axis) => {
  function pair(cache: string, firstSize: number): string {
    const first = zone(
      2,
      cell(0, firstSize, axis),
      'type-v2="visual" name="A"',
      `<layout-cache ${cache}/>`,
    );
    const second = zone(
      3,
      cell(firstSize, 100000 - firstSize, axis),
      'type-v2="text"',
      '<formatted-text><run>Title</run></formatted-text>',
    );
    return workbook(flow(first + second, axis));
  }

  it.each([
    'type-w="fixed" type-h="fixed" fixed-size-w="100" fixed-size-h="100"',
    'type-w="scalable" type-h="scalable" minwidth="100" minheight="100" has-max-size-w="true" has-max-size-h="true" maxwidth="200" maxheight="200"',
  ])('preserves the first known initial size despite unknown later text metrics: %s', (cache) => {
    const expected = pair(cache, 10000);
    expect(verify(expected, expected)).toBe(true);
    expect(verify(pair(cache, 20000), expected)).toBe(true);
    expect(verify(expected, pair(cache, 50000))).toBe(false);
    expect(verify(expected, pair(cache, 15000))).toBe(false);
    expect(verify(expected, pair(cache, 20000))).toBe(false);
  });
});

describe.each<Axis>(['vert', 'horz'])('partial %s metrics with a manual sibling', (axis) => {
  const fixedCache = (pixels: number): string =>
    `<layout-cache type-w="fixed" fixed-size-w="${pixels}" type-h="fixed" fixed-size-h="${pixels}"/>`;

  function triplet(
    sizes: [number, number, number],
    request: number,
    lastCache: string,
    manualCache = fixedCache(request),
  ): string {
    let offset = 0;
    const cells = sizes.map((size, index) => {
      const rect = cell(offset * 100, size * 100, axis);
      offset += size;
      return zone(
        index + 2,
        rect,
        index === 1
          ? 'type-v2="text"'
          : `type-v2="visual" name="${index === 0 ? 'A' : 'B'}"${index === 0 ? ` is-fixed="true" fixed-size="${request}"` : ''}`,
        index === 0
          ? manualCache
          : index === 1
            ? '<formatted-text><run>Title</run></formatted-text>'
            : lastCache,
      );
    });
    return workbook(flow(cells.join(''), axis))
      .replace('<worksheets>', '<worksheets><worksheet name="B"/>')
      .replace('<viewpoints>', '<viewpoints><viewpoint name="B"/>');
  }

  it.each([
    { kind: 'fixed', cache: fixedCache(100) },
    {
      kind: 'bounded scalable',
      cache:
        '<layout-cache type-w="scalable" minwidth="100" has-max-size-w="true" maxwidth="200" type-h="scalable" minheight="100" has-max-size-h="true" maxheight="200"/>',
    },
  ])('does not grow the last $kind tile beside a positive manual request', ({ cache }) => {
    const expected = triplet([100, 200, 100], 100, cache);
    expect(verify(expected, expected)).toBe(true);
    expect(verify(expected, triplet([100, 800, 100], 100, cache))).toBe(true);
    expect(verify(expected, triplet([100, 100, 800], 100, cache))).toBe(false);
  });

  it('bounds the last-tile residual by the retained manual shortfall', () => {
    const expected = triplet([936, 10, 10], 937, fixedCache(10));
    expect(verify(expected, expected)).toBe(true);
    expect(verify(expected, triplet([936, 54, 10], 937, fixedCache(10)))).toBe(true);
    expect(verify(expected, triplet([936, 10, 54], 937, fixedCache(10)))).toBe(false);
  });

  it('retains the last-tile residual when an oversized manual request is capped', () => {
    const expected = triplet([936, 10, 10], 1200, fixedCache(10));
    expect(verify(expected, expected)).toBe(true);
    expect(verify(expected, triplet([936, 10, 54], 1200, fixedCache(10)))).toBe(true);
  });

  it('retains the last-tile residual from zero-request scalable manual fallback', () => {
    const manualCache =
      '<layout-cache type-w="scalable" minwidth="800" has-max-size-w="false" type-h="scalable" minheight="800" has-max-size-h="false"/>';
    const expected = triplet([0, 500, 100], 0, fixedCache(100), manualCache);
    expect(verify(expected, expected)).toBe(true);
    expect(verify(expected, triplet([0, 500, 500], 0, fixedCache(100), manualCache))).toBe(true);
  });
});

describe('horizontal singleton width types and native cache defaults', () => {
  function single(cache: string, rect: Rect): string {
    return workbook(
      flow(zone(2, rect, 'type-v2="visual" name="A"', `<layout-cache ${cache}/>`), 'horz'),
      wideSize,
    );
  }

  it.each([
    {
      name: 'bounded scalable width',
      cache:
        'type-w="scalable" minwidth="100" has-max-size-w="true" maxwidth="200" type-h="fixed" fixed-size-h="100"',
      height: 12500,
    },
    {
      name: 'omitted fixed width',
      cache: 'type-w="fixed" type-h="fixed" fixed-size-h="100"',
      height: 12500,
    },
    {
      name: 'omitted fixed height',
      cache: 'type-w="fixed" fixed-size-w="100" type-h="fixed"',
      height: 37500,
    },
    { name: 'both omitted fixed sizes', cache: 'type-w="fixed" type-h="fixed"', height: 37500 },
    {
      name: 'explicit fixed sizes',
      cache: 'type-w="fixed" fixed-size-w="100" type-h="fixed" fixed-size-h="100"',
      height: 12500,
    },
    {
      name: 'oversubscribed bounded width',
      cache:
        'type-w="scalable" minwidth="1200" has-max-size-w="true" maxwidth="2000" type-h="fixed" fixed-size-h="100"',
      height: 100000,
    },
    {
      name: 'unbounded scalable width',
      cache:
        'type-w="scalable" minwidth="100" has-max-size-w="false" type-h="fixed" fixed-size-h="100"',
      height: 100000,
    },
  ])('verifies native height for $name', ({ cache, height }) => {
    const expected = single(cache, [0, 0, 50000, 100000]);
    expect(verify(expected, expected)).toBe(true);
    expect(verify(expected, single(cache, [0, 0, 100000, height]))).toBe(true);
    expect(
      verify(expected, single(cache, [0, 0, 100000, height === 100000 ? 12500 : 100000])),
    ).toBe(false);
  });
});

describe('inherited device viewport', () => {
  function phone(rect: Rect, ownSize?: string): string {
    const content = flow(zone(12, rect, 'type-v2="empty"'), 'vert', rect, 11);
    return `<devicelayouts><devicelayout name="Phone">${ownSize === undefined ? '' : `<size ${ownSize}/>`}<zones>${zone(10, full, 'type-v2="layout-basic"', content + style(10))}</zones></devicelayout></devicelayouts>`;
  }

  it.each([undefined, fixedSize])(
    'inherits the fixed main viewport with readback device size %s',
    (readbackSize) => {
      const expected = workbook('', fixedSize, phone([2000, 2000, 96000, 96000]));
      const actual = workbook('', fixedSize, phone([1000, 1000, 98000, 98000], readbackSize));
      expect(verify(expected, expected)).toBe(true);
      expect(verify(expected, actual)).toBe(true);
    },
  );

  it('retains conservative handling when the inherited viewport is genuinely variable', () => {
    const dynamic = 'minwidth="1000" maxwidth="2000" minheight="1000" maxheight="2000"';
    const expected = workbook('', dynamic, phone([2000, 2000, 96000, 96000]));
    expect(verify(expected, expected)).toBe(true);
    expect(verify(expected, workbook('', dynamic, phone([1000, 1000, 98000, 98000])))).toBe(false);
  });

  it('uses a customized device size instead of the inherited main size', () => {
    const own = 'minwidth="400" maxwidth="400" minheight="800" maxheight="800"';
    const expected = workbook('', fixedSize, phone([5000, 2500, 90000, 95000], own));
    expect(verify(expected, workbook('', fixedSize, phone([2500, 1250, 95000, 97500], own)))).toBe(
      true,
    );
    expect(verify(expected, workbook('', fixedSize, phone([1000, 1000, 98000, 98000], own)))).toBe(
      false,
    );
  });
});
