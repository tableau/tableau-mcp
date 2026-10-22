import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

import {
  readbackReflowDashboard,
  REFLOW_DASHBOARD_NAME,
  reflowWorkbook,
  submittedReflowDashboard,
} from './dashboardReflowFixtures.js';
import { createDashboardReadbackVerifier } from './dashboardViewpoints.js';

type Rect = [x: number, y: number, width: number, height: number];
type Axis = 'horz' | 'vert';

const full: Rect = [0, 0, 100000, 100000];

function spacing(pixels = 0): string {
  return `<zone-style><format attr="margin" value="${pixels}"/>
    <format attr="padding" value="0"/><format attr="border-width" value="0"/></zone-style>`;
}

function zone(id: number, rect: Rect, attributes = '', content = ''): string {
  const [x, y, w, h] = rect;
  return `<zone id="${id}" x="${x}" y="${y}" w="${w}" h="${h}" ${attributes}>${content}</zone>`;
}

function flow(id: number, rect: Rect, content: string, axis: Axis = 'vert', inset = 0): string {
  return zone(id, rect, `type-v2="layout-flow" param="${axis}"`, content + spacing(inset));
}

function workbook(
  zones: string,
  size = 'minwidth="1000" maxwidth="1000" minheight="1000" maxheight="1000"',
  zonesAttributes = '',
): string {
  return `<workbook><dashboards><dashboard name="D">
    <size ${size}/>
    <zones ${zonesAttributes}>${zones}</zones></dashboard></dashboards>
    <windows><window class="dashboard" name="D"><viewpoints/></window></windows></workbook>`;
}

function basic(content: string, inset = 0): string {
  return workbook(zone(1, full, 'type-v2="layout-basic"', content + spacing(inset)));
}

function registerWorksheets(xml: string, names: string[]): string {
  return xml
    .replace(
      '<workbook>',
      `<workbook><worksheets>${names.map((name) => `<worksheet name="${name}"/>`).join('')}</worksheets>`,
    )
    .replace(
      '<viewpoints/>',
      `<viewpoints>${names.map((name) => `<viewpoint name="${name}"/>`).join('')}</viewpoints>`,
    );
}

function verify(expected: string, actual: string): boolean {
  return createDashboardReadbackVerifier(expected, 'D')(actual);
}

function columns(
  rects: Rect[],
  {
    hidden = -1,
    leaves = rects,
    inset = 0,
  }: {
    hidden?: number;
    leaves?: Rect[];
    inset?: number;
  } = {},
): string {
  return basic(
    rects
      .map((rect, index) =>
        zone(
          10 + index * 2,
          rect,
          `type-v2="layout-flow" param="vert"${index === hidden ? ' hidden-by-user="true"' : ''}`,
          zone(11 + index * 2, leaves[index], 'type-v2="empty"') + spacing(),
        ),
      )
      .join(''),
    inset,
  );
}

function transpose(rect: Rect, axis: Axis): Rect {
  return axis === 'vert' ? rect : [rect[1], rect[0], rect[3], rect[2]];
}

function flowChildren(rects: Rect[], axis: Axis = 'vert', inset = 0): string {
  return workbook(
    flow(
      1,
      full,
      rects
        .map((rect, index) => zone(index + 2, transpose(rect, axis), 'type-v2="empty"'))
        .join(''),
      axis,
      inset,
    ),
  );
}

describe('native basic layout normalization', () => {
  const clean = columns([
    [0, 0, 50000, 100000],
    [50000, 0, 50000, 100000],
  ]);

  it('retains an unchanged clean layout and an unchanged intermediate layout', () => {
    const intermediate = columns([
      [1000, 1000, 49000, 98000],
      [50000, 1000, 49000, 98000],
    ]);
    expect(verify(clean, clean)).toBe(true);
    expect(verify(intermediate, intermediate)).toBe(true);
    expect(verify(intermediate, clean)).toBe(true);
  });

  it.each([
    {
      name: 'joint shrink with an unexplained border',
      rects: [
        [10000, 10000, 40000, 80000],
        [50000, 10000, 40000, 80000],
      ] as Rect[],
    },
    {
      name: 'joint horizontal shift into unused parent space',
      rects: [
        [10000, 0, 40000, 100000],
        [50000, 0, 40000, 100000],
      ] as Rect[],
    },
  ])('rejects $name under an unchanged unstyled basic parent', ({ rects }) => {
    expect(verify(clean, columns(rects))).toBe(false);
  });

  it('rejects an arbitrary shrink of a single basic child and its descendants', () => {
    expect(verify(columns([full]), columns([[10000, 10000, 80000, 80000]]))).toBe(false);
  });

  it('normalizes to the basic parent content rectangle with authored spacing', () => {
    // A 10px margin on a 1000px dashboard is 1000 virtual units per edge.
    const expected = columns(
      [
        [2000, 2000, 48000, 96000],
        [50000, 2000, 48000, 96000],
      ],
      { inset: 10 },
    );
    const actual = columns(
      [
        [1000, 1000, 49000, 98000],
        [50000, 1000, 49000, 98000],
      ],
      { inset: 10 },
    );
    expect(verify(expected, actual)).toBe(true);
  });

  it('accepts native trimming of overlapping siblings after normalization', () => {
    // BasicStrategy scales the first right edge to 51020 and the second left
    // edge to 50000; ZoneFixup trims the first edge to that next sibling.
    const expected = columns([
      [1000, 1000, 50000, 98000],
      [50000, 1000, 49000, 98000],
    ]);
    expect(verify(expected, clean)).toBe(true);
  });

  it('accepts the native single-precision interior split after outer-edge expansion', () => {
    // float(100000 / 81889) and native integer truncation yield 26828,
    // while double arithmetic yields 26829.000232021393.
    const expected = columns([
      [0, 0, 21970, 81889],
      [21970, 0, 59919, 81889],
    ]);
    const actual = columns([
      [0, 0, 26828, 100000],
      [26828, 0, 73172, 100000],
    ]);
    expect(verify(expected, actual)).toBe(true);
  });
});

describe.each<Axis>(['vert', 'horz'])('native %s flow allocation', (axis) => {
  const expected = flowChildren(
    [
      [0, 0, 100000, 30000],
      [0, 30000, 100000, 70000],
    ],
    axis,
  );

  it('accepts equal native primary allocation for empty zones', () => {
    expect(
      verify(
        expected,
        flowChildren(
          [
            [0, 0, 100000, 50000],
            [0, 50000, 100000, 50000],
          ],
          axis,
        ),
      ),
    ).toBe(true);
  });

  it.each([
    {
      name: 'joint cross-axis collapse',
      rects: [
        [40000, 0, 1, 30000],
        [40000, 30000, 1, 70000],
      ] as Rect[],
    },
    {
      name: 'joint collapse into adjacent one-unit cells',
      rects: [
        [40000, 40000, 1, 1],
        [40000, 40001, 1, 1],
      ] as Rect[],
    },
    {
      name: 'first child offset from the primary client origin',
      rects: [
        [0, 1000, 100000, 30000],
        [0, 31000, 100000, 69000],
      ] as Rect[],
    },
    {
      name: 'primary collapse with the complete cross-axis extent and correct origin',
      rects: [
        [0, 0, 100000, 1],
        [0, 1, 100000, 1],
      ] as Rect[],
    },
    {
      name: 'one-unit first empty tile with complete client filling',
      rects: [
        [0, 0, 100000, 1],
        [0, 1, 100000, 99999],
      ] as Rect[],
    },
    {
      name: 'one-unit last empty tile with complete client filling',
      rects: [
        [0, 0, 100000, 99999],
        [0, 99999, 100000, 1],
      ] as Rect[],
    },
  ])('rejects $name with explicit zero spacing', ({ rects }) => {
    expect(verify(expected, flowChildren(rects, axis))).toBe(false);
  });

  it('accepts the authored 10px inset instead of assuming full parent bounds', () => {
    const before = flowChildren(
      [
        [0, 0, 100000, 30000],
        [0, 30000, 100000, 70000],
      ],
      axis,
      10,
    );
    const after = flowChildren(
      [
        [1000, 1000, 98000, 49000],
        [1000, 50000, 98000, 49000],
      ],
      axis,
      10,
    );
    expect(verify(before, after)).toBe(true);
  });

  it('retains legitimate trailing space when all flow children have fixed sizes', () => {
    const cells = [
      zone(
        3,
        transpose([0, 0, 100000, 10000], axis),
        'type-v2="empty" is-fixed="true" fixed-size="100"',
      ),
      zone(
        4,
        transpose([0, 10000, 100000, 10000], axis),
        'type-v2="empty" is-fixed="true" fixed-size="100"',
      ),
    ].join('');
    const before = basic(flow(2, [1000, 1000, 98000, 98000], cells, axis));
    const after = basic(flow(2, full, cells, axis));
    expect(verify(before, after)).toBe(true);
  });

  it('accepts the native integer-division remainder across six scalable children', () => {
    // GrowZones divides remaining virtual space by the number of
    // unbounded scalable children; 100000 / 6 leaves a four-unit remainder.
    const render = (sizes: number[]): string => {
      let offset = 0;
      const cells = sizes.map((size, index) => {
        const rect = transpose([0, offset, 100000, size], axis);
        offset += size;
        return zone(
          index + 2,
          rect,
          'type-v2="empty"',
          '<layout-cache type-h="scalable" type-w="scalable" minheight="0" minwidth="0"/>',
        );
      });
      return workbook(flow(1, full, cells.join(''), axis));
    };
    expect(
      verify(render([20000, 16000, 16000, 16000, 16000, 16000]), render(Array(6).fill(16666))),
    ).toBe(true);
  });
});

describe.each<Axis>(['vert', 'horz'])('submitted %s primary allocation metrics', (axis) => {
  function cachedFlow(sizes: number[], caches: string[]): string {
    let offset = 0;
    const cells = sizes.map((size, index) => {
      const rect = transpose([0, offset, 100000, size], axis);
      offset += size;
      return zone(
        index + 2,
        rect,
        `type-v2="visual" name="Sheet ${index + 1}"`,
        `<layout-cache ${caches[index]}/>`,
      );
    });
    return registerWorksheets(
      workbook(flow(1, full, cells.join(''), axis)),
      sizes.map((_, index) => `Sheet ${index + 1}`),
    );
  }

  function scalableFlow(sizes: number[], minima = sizes.map(() => 0)): string {
    return cachedFlow(
      sizes,
      minima.map(
        (minimum) =>
          `type-h="scalable" type-w="scalable" minheight="${minimum}" minwidth="${minimum}" has-max-size-h="false" has-max-size-w="false"`,
      ),
    );
  }

  it('accepts equal native allocation from identical submitted unbounded scalable metrics', () => {
    const expected = scalableFlow([30000, 70000]);
    expect(verify(expected, expected)).toBe(true);
    expect(verify(expected, scalableFlow([50000, 50000]))).toBe(true);
  });

  it.each([1, 99999])(
    'rejects a one-unit tile at split %s despite complete client filling',
    (split) => {
      const expected = scalableFlow([50000, 50000]);
      expect(verify(expected, expected)).toBe(true);
      expect(verify(expected, scalableFlow([split, 100000 - split]))).toBe(false);
    },
  );

  it('grows unequal submitted minima by the same native extra allocation', () => {
    const expected = scalableFlow([30000, 70000], [100, 300]);
    expect(verify(expected, scalableFlow([40000, 60000], [100, 300]))).toBe(true);
    expect(verify(expected, scalableFlow([50000, 50000], [100, 300]))).toBe(false);
  });

  it('allows native shrinking below oversubscribed submitted scalable minima', () => {
    const expected = scalableFlow([20000, 80000], [600, 900]);
    expect(verify(expected, scalableFlow([50000, 50000], [600, 900]))).toBe(true);
    expect(verify(expected, scalableFlow([40000, 60000], [600, 900]))).toBe(false);
  });

  it('assigns native shrink rounding remainder to the last child in document order', () => {
    const minima = Array(7).fill(200);
    const expected = scalableFlow([10000, 10000, 10000, 10000, 20000, 20000, 20000], minima);
    expect(
      verify(expected, scalableFlow([14285, 14285, 14285, 14285, 14285, 14285, 14290], minima)),
    ).toBe(true);
    expect(
      verify(expected, scalableFlow([14290, 14285, 14285, 14285, 14285, 14285, 14285], minima)),
    ).toBe(false);
  });

  it('accepts changed fixed-cache allocation with native trailing space', () => {
    const caches = Array(2).fill(
      'type-w="fixed" type-h="fixed" fixed-size-w="100" fixed-size-h="100"',
    );
    const expected = cachedFlow([50000, 50000], caches);
    expect(verify(expected, cachedFlow([10000, 10000], caches))).toBe(true);
  });

  it('leaves bounded scalable children at their initial size while unbounded children grow', () => {
    const caches = [
      'type-w="scalable" type-h="scalable" minwidth="100" minheight="100" has-max-size-w="true" has-max-size-h="true" maxwidth="200" maxheight="200"',
      'type-w="scalable" type-h="scalable" minwidth="100" minheight="100" has-max-size-w="false" has-max-size-h="false"',
    ];
    const expected = cachedFlow([50000, 50000], caches);
    expect(verify(expected, cachedFlow([10000, 90000], caches))).toBe(true);
    expect(verify(expected, cachedFlow([20000, 80000], caches))).toBe(false);
  });

  it('uses native scalable cache defaults when minimum and maximum flags are omitted', () => {
    const caches = Array(2).fill('type-w="scalable" type-h="scalable"');
    const expected = cachedFlow([30000, 70000], caches);
    expect(verify(expected, cachedFlow([50000, 50000], caches))).toBe(true);
    expect(verify(expected, cachedFlow([1, 99999], caches))).toBe(false);
  });
});

describe('captured worksheet primary allocation', () => {
  const readback = reflowWorkbook(readbackReflowDashboard);
  const collapsed = (() => {
    const doc = new DOMParser().parseFromString(readback, 'text/xml');
    const zones = Array.from(doc.getElementsByTagName('zone'));
    const title = zones.find((element) => element.getAttribute('id') === '6')!;
    const worksheet = zones.find((element) => element.getAttribute('id') === '7')!;
    title.setAttribute('h', '99999');
    worksheet.setAttribute('y', '99999');
    worksheet.setAttribute('h', '1');
    return new XMLSerializer().serializeToString(doc);
  })();

  it('rejects the worksheet collapse against its submitted scalable minimum', () => {
    const matches = createDashboardReadbackVerifier(readback, REFLOW_DASHBOARD_NAME);
    expect(matches(readback)).toBe(true);
    expect(matches(collapsed)).toBe(false);
  });

  it('uses native readback metrics to reject a collapse without authorizing arbitrary reflow', () => {
    const submitted = reflowWorkbook(submittedReflowDashboard);
    const matches = createDashboardReadbackVerifier(submitted, REFLOW_DASHBOARD_NAME);
    expect(matches(readback)).toBe(true);
    expect(matches(collapsed)).toBe(false);
  });

  function readbackMinimum(xml: string, value: string | null): string {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const worksheet = Array.from(doc.getElementsByTagName('zone')).find(
      (element) => element.getAttribute('id') === '7',
    )!;
    const cache = worksheet.getElementsByTagName('layout-cache')[0];
    if (value === null) cache.removeAttribute('minheight');
    else cache.setAttribute('minheight', value);
    return new XMLSerializer().serializeToString(doc);
  }

  it('rejects a collapsed worksheet when native readback omits its minimum', () => {
    const submitted = reflowWorkbook(submittedReflowDashboard);
    const matches = createDashboardReadbackVerifier(submitted, REFLOW_DASHBOARD_NAME);
    expect(matches(readbackMinimum(readback, null))).toBe(true);
    expect(matches(readbackMinimum(collapsed, null))).toBe(false);
  });

  it('rejects a malformed native readback minimum instead of treating it as unknown', () => {
    const submitted = reflowWorkbook(submittedReflowDashboard);
    const matches = createDashboardReadbackVerifier(submitted, REFLOW_DASHBOARD_NAME);
    expect(matches(readback)).toBe(true);
    expect(matches(readbackMinimum(readback, 'bad'))).toBe(false);
  });
});

describe.each<Axis>(['vert', 'horz'])('native %s empty-zone allocation boundaries', (axis) => {
  function emptyCells(sizes: number[], fixedIndex = -1, manual = false): string {
    let offset = 0;
    return sizes
      .map((size, index) => {
        const rect = transpose([0, offset, 100000, size], axis);
        offset += size;
        const fixed =
          index === fixedIndex ? ` fixed-size="200"${manual ? ' is-fixed="true"' : ''}` : '';
        return zone(index + 3, rect, `type-v2="empty"${fixed}`);
      })
      .join('');
  }

  it('rejects one-unit allocation with a dynamic owning primary dimension', () => {
    const size =
      axis === 'vert'
        ? 'minwidth="1000" maxwidth="1000" minheight="800" maxheight="1200"'
        : 'minwidth="800" maxwidth="1200" minheight="1000" maxheight="1000"';
    const render = (sizes: number[]): string =>
      workbook(flow(2, full, emptyCells(sizes), axis), size);
    const expected = render([50000, 50000]);
    expect(verify(expected, expected)).toBe(true);
    expect(verify(expected, render([1, 99999]))).toBe(false);
  });

  it.each([false, true].flatMap((manual) => [1, 10000].map((split) => ({ manual, split }))))(
    'checks automatic siblings around an unchanged fixed-size tile (manual=$manual, split=$split)',
    ({ manual, split }) => {
      const render = (sizes: number[]): string =>
        workbook(flow(2, full, emptyCells(sizes, 2, manual), axis));
      const expected = render([20000, 20000, 20000, 20000, 20000]);
      expect(verify(expected, expected)).toBe(true);
      expect(verify(expected, render([split, 40000 - split, 20000, 20000, 20000]))).toBe(false);
    },
  );

  it('retains native automatic allocation beside an active manually fixed empty tile', () => {
    const cells = emptyCells([40000, 20000, 40000], 1, true);
    const before = basic(flow(2, [1000, 1000, 98000, 98000], cells, axis));
    const after = basic(flow(2, full, cells, axis));
    expect(verify(before, after)).toBe(true);
  });

  it('does not activate native manual sizing from the numeric is-fixed value', () => {
    const cells = emptyCells([20000, 20000, 20000, 20000, 20000], 2).replace(
      'fixed-size="200"',
      'fixed-size="400" is-fixed="1"',
    );
    const before = basic(flow(2, [1000, 1000, 98000, 98000], cells, axis));
    const after = basic(flow(2, full, cells, axis));
    expect(verify(before, after)).toBe(true);
  });

  it('shrinks an oversized manual tile while reserving native minimum space for automatic siblings', () => {
    const render = (sizes: number[]): string =>
      workbook(
        flow(
          2,
          full,
          emptyCells(sizes, 0, true).replace('fixed-size="200"', 'fixed-size="1200"'),
          axis,
        ),
      );
    const expected = render([93600, 2000, 4400]);
    expect(verify(expected, render([93600, 3200, 3200]))).toBe(true);
    expect(verify(expected, render([93600, 4000, 2400]))).toBe(false);
  });

  it('rejects unequal empty siblings around unknown text metrics without a manual tile', () => {
    const render = (sizes: [number, number, number]): string => {
      const [first, text, last] = sizes;
      const cells = [
        zone(3, transpose([0, 0, 100000, first], axis), 'type-v2="empty"'),
        zone(
          4,
          transpose([0, first, 100000, text], axis),
          'type-v2="text"',
          '<formatted-text><run>Title</run></formatted-text>',
        ),
        zone(5, transpose([0, first + text, 100000, last], axis), 'type-v2="empty"'),
      ].join('');
      return workbook(flow(2, full, cells, axis));
    };
    const expected = render([49000, 2000, 49000]);
    expect(verify(expected, expected)).toBe(true);
    expect(verify(expected, render([3200, 3200, 93600]))).toBe(false);
  });
});

describe('hidden zones under distinct native parent strategies', () => {
  it('normalizes a hidden direct basic child while retaining its hidden descendant', () => {
    const source: Rect = [1000, 1000, 98000, 98000];
    const expected = columns([source], { hidden: 0 });
    const actual = columns([full], { hidden: 0, leaves: [source] });
    expect(verify(expected, actual)).toBe(true);
    expect(verify(expected, columns([full], { hidden: 0, leaves: [full] }))).toBe(false);
  });

  it('normalizes hidden and visible basic siblings together without laying out hidden descendants', () => {
    const hiddenSource: Rect = [1000, 1000, 24500, 98000];
    const expected = columns([hiddenSource, [25500, 1000, 73500, 98000]], { hidden: 0 });
    const actual = columns(
      [
        [0, 0, 25000, 100000],
        [25000, 0, 75000, 100000],
      ],
      { hidden: 0, leaves: [hiddenSource, [25000, 0, 75000, 100000]] },
    );
    expect(verify(expected, actual)).toBe(true);
  });
});

describe('independent authored coordinate guards', () => {
  const settings = ['is-fixed="true"', 'is-fixed="1"', 'fixed-size="400"'];

  it.each(settings)('accepts unchanged fixed geometry for %s', (setting) => {
    const xml = workbook(flow(1, full, zone(2, full, `type-v2="empty" ${setting}`)));
    expect(verify(xml, xml)).toBe(true);
  });

  it.each(
    settings.flatMap((setting) =>
      ['x', 'y', 'w', 'h'].map((coordinate) => ({ setting, coordinate })),
    ),
  )(
    'requires the fixed $coordinate guard for $setting with compatible automatic siblings',
    ({ setting, coordinate }) => {
      const activeManual = setting === 'is-fixed="true"';
      const crossChange = activeManual && ['w', 'h'].includes(coordinate);
      const axis = crossChange
        ? coordinate === 'w'
          ? 'vert'
          : 'horz'
        : ['x', 'w'].includes(coordinate)
          ? 'horz'
          : 'vert';
      const movedOrigin = ['x', 'y'].includes(coordinate);
      const render = (changed: boolean): string => {
        const delta = changed && !crossChange ? 100 : 0;
        const crossSize = crossChange && !changed ? 99900 : 100000;
        const first: Rect = [0, 0, crossSize, 30000 + (movedOrigin ? delta : 0)];
        const fixed: Rect = [
          0,
          30000 + (movedOrigin ? delta : 0),
          crossSize,
          40000 + (movedOrigin ? 0 : delta),
        ];
        const last: Rect = [0, 70000 + delta, crossSize, 30000 - delta];
        const content = flow(
          2,
          transpose([0, 0, crossSize, 100000], axis),
          [
            zone(3, transpose(first, axis), 'type-v2="visual" name="Before"'),
            zone(
              4,
              transpose(fixed, axis),
              `type-v2="visual" name="Fixed" ${setting}${activeManual ? ' fixed-size="400"' : ''}`,
            ),
            zone(5, transpose(last, axis), 'type-v2="visual" name="After"'),
          ].join(''),
          axis,
        );
        return registerWorksheets(crossChange ? basic(content) : workbook(content), [
          'Before',
          'Fixed',
          'After',
        ]);
      };
      const expected = render(false);
      expect(verify(expected, expected)).toBe(true);
      expect(verify(expected, render(true))).toBe(false);
    },
  );

  it.each(['x', 'y', 'w', 'h'])(
    'requires the floating %s guard without descendant masking',
    (coordinate) => {
      const expected = workbook(flow(1, [10000, 10000, 50000, 50000], ''));
      const changed: Rect = [10000, 10000, 50000, 50000];
      changed[['x', 'y', 'w', 'h'].indexOf(coordinate)] += 100;
      expect(verify(expected, expected)).toBe(true);
      expect(verify(expected, workbook(flow(1, changed, '')))).toBe(false);
    },
  );
});

describe('native spacing and coordinate contexts', () => {
  function styledBasic(
    rects: Rect[],
    formats: [attribute: string, value: string][],
    size?: string,
    parent: Rect = full,
    zonesAttributes = '',
  ): string {
    const style = `<zone-style>${formats
      .map(([attribute, value]) => `<format attr="${attribute}" value="${value}"/>`)
      .join('')}</zone-style>`;
    return workbook(
      zone(
        1,
        parent,
        'type-v2="layout-basic"',
        rects.map((rect, index) => zone(index + 2, rect, 'type-v2="empty"')).join('') + style,
      ),
      size,
      zonesAttributes,
    );
  }

  it('matches the native BasicStrategyTest four-child spacing oracle', () => {
    // Native BasicStrategyTest.cpp uses margin 5, solid border 6 and padding 7
    // on a 1000x800 viewport: content bounds are (1800,2250)..(98200,97750).
    const style: [string, string][] = [
      ['margin', '5'],
      ['border-style', 'solid'],
      ['border-width', '6'],
      ['padding', '7'],
    ];
    const size = 'minwidth="1000" maxwidth="1000" minheight="800" maxheight="800"';
    const expected = styledBasic(
      [
        [0, 0, 25000, 25000],
        [25000, 0, 50000, 25000],
        [75000, 0, 25000, 25000],
        [0, 25000, 100000, 75000],
      ],
      style,
      size,
    );
    const actual = styledBasic(
      [
        [1800, 2250, 24100, 23875],
        [25900, 2250, 48200, 23875],
        [74100, 2250, 24100, 23875],
        [1800, 26125, 96400, 71625],
      ],
      style,
      size,
    );
    expect(verify(expected, actual)).toBe(true);
  });

  it('rounds margin, border and padding separately before summing virtual insets', () => {
    // ZoneViewTransform::GetZoneBox deflates each group separately. At 997px,
    // each 1px rounds to 100 virtual units: the total is 300, not round(300.9).
    const style: [string, string][] = [
      ['margin', '1'],
      ['border-style', 'solid'],
      ['border-width', '1'],
      ['padding', '1'],
    ];
    const size = 'minwidth="997" maxwidth="997" minheight="997" maxheight="997"';
    const expected = styledBasic([full], style, size);
    expect(verify(expected, styledBasic([[300, 300, 99400, 99400]], style, size))).toBe(true);
    expect(verify(expected, styledBasic([[301, 301, 99398, 99398]], style, size))).toBe(false);
  });

  it.each([false, true])(
    'retains per-side overrides independent of XML order (side first=%s)',
    (sideFirst) => {
      // StyledBox stores AllSides and each side independently; an explicit side
      // wins regardless of whether its format precedes the AllSides format.
      const overrides: [string, string][] = [
        ['margin-left', '20'],
        ['margin-right', '0'],
      ];
      const general: [string, string][] = [
        ['margin', '10'],
        ['border-width', '0'],
        ['padding', '0'],
      ];
      const style = sideFirst ? [...overrides, ...general] : [...general, ...overrides];
      expect(
        verify(styledBasic([full], style), styledBasic([[2000, 1000, 98000, 98000]], style)),
      ).toBe(true);
    },
  );

  it('uses pixel inset units when the owning zones are in pixels', () => {
    const parent: Rect = [0, 0, 1000, 800];
    const size = 'minwidth="1000" maxwidth="1000" minheight="800" maxheight="800"';
    const style: [string, string][] = [['margin', '10']];
    const expected = styledBasic([parent], style, size, parent, 'is-pixels="true"');
    const actual = styledBasic([[10, 10, 980, 780]], style, size, parent, 'is-pixels="true"');
    expect(verify(expected, actual)).toBe(true);
  });

  it('uses the nearest Phone layout fixed size instead of the dashboard size', () => {
    const device = (rect: Rect): string =>
      `<devicelayouts><devicelayout name="Phone">
        <size minwidth="400" maxwidth="400" minheight="800" maxheight="800"/>
        <zones>${zone(10, full, 'type-v2="layout-basic"', zone(11, rect, 'type-v2="empty"') + spacing(10))}</zones>
      </devicelayout></devicelayouts>`;
    const render = (rect: Rect): string =>
      workbook('', 'minwidth="1000" maxwidth="1000" minheight="800" maxheight="800"').replace(
        '</dashboard>',
        device(rect) + '</dashboard>',
      );
    const expected = render(full);
    expect(verify(expected, render([2500, 1250, 95000, 97500]))).toBe(true);
    expect(verify(expected, render([1000, 1250, 98000, 97500]))).toBe(false);
  });

  it.each([
    'minwidth="1000" maxwidth="2000" minheight="1000" maxheight="1000"',
    'minwidth="1000" maxwidth="1000" minheight="1000"',
    'minwidth="0" maxwidth="0" minheight="0" maxheight="0"',
    '',
  ])('requires unchanged geometry when nonzero insets have no exact viewport: %s', (size) => {
    const style: [string, string][] = [['margin', '10']];
    const expected = styledBasic([full], style, size);
    expect(verify(expected, expected)).toBe(true);
    expect(verify(expected, styledBasic([[1000, 1000, 98000, 98000]], style, size))).toBe(false);
  });

  it('needs no runtime height when every vertical inset is zero', () => {
    const size = 'minwidth="1000" maxwidth="1000"';
    const style: [string, string][] = [['margin-left', '10']];
    expect(
      verify(
        styledBasic([full], style, size),
        styledBasic([[1000, 0, 99000, 100000]], style, size),
      ),
    ).toBe(true);
  });

  it.each(['margin', 'padding'])(
    'retains safe signed %s inflation instead of clamping it',
    (attribute) => {
      // ZoneParser parses signed integers and StyledBox setters retain them;
      // deflating a negative inset expands the content rectangle.
      const style: [string, string][] = [[attribute, '-10']];
      expect(
        verify(styledBasic([full], style), styledBasic([[-1000, -1000, 102000, 102000]], style)),
      ).toBe(true);
    },
  );

  it('does not repair an overlapping basic arrangement when the source extent already matches the client', () => {
    // BasicStrategy invokes ZoneFixup only inside its childExtents != contentRect branch.
    const expected = columns([
      [0, 0, 60000, 100000],
      [50000, 0, 50000, 100000],
    ]);
    expect(verify(expected, expected)).toBe(true);
    expect(
      verify(
        expected,
        columns([
          [0, 0, 50000, 100000],
          [50000, 0, 50000, 100000],
        ]),
      ),
    ).toBe(false);
  });
});

describe('readback geometry semantics and native integer range', () => {
  const unchanged = flowChildren([
    [0, 0, 100000, 30000],
    [0, 30000, 100000, 70000],
  ]);

  it.each([
    'hidden-by-user="true"',
    'hidden-by-user="1"',
    'hidden="true"',
    'is-fixed="true"',
    'is-fixed="1"',
    'strategy-id="layout-basic"',
    'layout-horz="true"',
  ])('rejects active readback-only %s even when coordinates match', (attribute) => {
    expect(verify(unchanged, unchanged.replace('id="1"', `id="1" ${attribute}`))).toBe(false);
  });

  it('rejects a readback-only switch from virtual to pixel coordinates', () => {
    expect(verify(unchanged, unchanged.replace('<zones ', '<zones is-pixels="true" '))).toBe(false);
  });

  it.each<Rect>([
    [2147483648, 0, 100, 100],
    [-2147483649, 0, 100, 100],
    [9007199254740992, 0, 100, 100],
    [2147483640, 0, 10, 100],
    [0, 2147483640, 100, 10],
    [-2147483648, 0, -1, 100],
  ])('rejects out-of-int32 coordinates or overflowing edges: %j', (...rect) => {
    const xml = workbook(zone(1, rect, 'type-v2="empty"'));
    expect(verify(xml, xml)).toBe(false);
  });

  it.each<Rect>([
    [2147483500, 0, 100, 100],
    [-2147483600, 0, 100, 100],
  ])('does not impose dashboard bounds on valid floating native coordinates: %j', (...rect) => {
    const xml = workbook(zone(1, rect, 'type-v2="empty"'));
    expect(verify(xml, xml)).toBe(true);
  });
});

describe('native single-horizontal fixed-height fitting', () => {
  function render(rect: Rect, cache = '', style = ''): string {
    return registerWorksheets(
      workbook(
        flow(1, full, zone(2, rect, 'type-v2="visual" name="Sheet"', cache + style), 'horz'),
        'minwidth="1000" maxwidth="1000" minheight="800" maxheight="800"',
      ),
      ['Sheet'],
    );
  }

  it('does not fit an empty zone from cached visual metrics', () => {
    const cache =
      '<layout-cache type-w="fixed" fixed-size-w="100" type-h="fixed" fixed-size-h="100"/>';
    const renderEmpty = (rect: Rect): string =>
      workbook(
        flow(1, full, zone(2, rect, 'type-v2="empty"', cache), 'horz'),
        'minwidth="1000" maxwidth="1000" minheight="800" maxheight="800"',
      );
    const expected = renderEmpty(full);
    expect(verify(expected, expected)).toBe(true);
    expect(verify(expected, renderEmpty([0, 0, 100000, 12500]))).toBe(false);
  });

  it.each(['type-w="fixed" fixed-size-w="100"', 'type-w="fixed" fixed-size-w="300"'])(
    'accepts fitting from submitted fixed-height metrics with %s',
    (primary) => {
      // FlowInfo::SetSingleHorizontal fits the fixed pixel height only on the
      // GrowZones branch, while assigning the single child the entire client width.
      const cache = `<layout-cache ${primary} type-h="fixed" fixed-size-h="100"/>`;
      const expected = render([0, 0, 50000, 100000], cache);
      expect(verify(expected, render([0, 0, 100000, 12500], cache))).toBe(true);
      expect(verify(expected, render([0, 0, 50000, 12500], cache))).toBe(false);
      expect(verify(expected, render([0, 0, 100000, 10000], cache))).toBe(false);
    },
  );

  it('includes submitted top and bottom child margins in the fixed height', () => {
    const cache =
      '<layout-cache type-w="fixed" fixed-size-w="100" type-h="fixed" fixed-size-h="100"/>';
    const style =
      '<zone-style><format attr="margin-top" value="5"/><format attr="margin-bottom" value="7"/></zone-style>';
    const expected = render([0, 0, 50000, 100000], cache, style);
    // (100 + 5 + 7)px * 100000 / 800px = 14000 virtual units.
    expect(verify(expected, render([0, 0, 100000, 14000], cache, style))).toBe(true);
  });

  it('does not authorize a short cross-axis extent from actual-only cache metrics', () => {
    const cache =
      '<layout-cache type-w="fixed" fixed-size-w="100" type-h="fixed" fixed-size-h="100"/>';
    expect(verify(render([0, 0, 50000, 100000]), render([0, 0, 100000, 12500], cache))).toBe(false);
  });

  it('does not fit an unbounded scalable single child to its cached fixed height', () => {
    const cache =
      '<layout-cache type-w="scalable" has-max-size-w="false" type-h="fixed" fixed-size-h="100"/>';
    expect(verify(render([0, 0, 50000, 100000], cache), render([0, 0, 100000, 12500], cache))).toBe(
      false,
    );
  });

  it('fits an omitted submitted minimum width from the readback minimum', () => {
    const cache = (minimum: string): string =>
      `<layout-cache type-w="scalable"${minimum} has-max-size-w="true" maxwidth="3000" type-h="fixed" fixed-size-h="100"/>`;
    const expected = render([0, 0, 50000, 100000], cache(''));
    expect(verify(expected, render([0, 0, 100000, 12500], cache('')))).toBe(true);
    // A 2000px readback minimum cannot fit the 1000px client, so GrowZones does not run.
    expect(verify(expected, render([0, 0, 100000, 12500], cache(' minwidth="2000"')))).toBe(false);
    expect(verify(expected, render([0, 0, 100000, 100000], cache(' minwidth="2000"')))).toBe(true);
  });

  it('retains the full cross axis when the fixed primary metric requires native shrinking', () => {
    // A 2000px requested width cannot fit a 1000px client. ShrinkZones runs;
    // the SetSingleHorizontal height exception exists only in GrowZones.
    const cache =
      '<layout-cache type-w="fixed" fixed-size-w="2000" type-h="fixed" fixed-size-h="100"/>';
    const expected = render([0, 0, 50000, 100000], cache);
    expect(verify(expected, render([0, 0, 100000, 100000], cache))).toBe(true);
    expect(verify(expected, render([0, 0, 100000, 12500], cache))).toBe(false);
  });
});

describe('shipped tiled strategy hints', () => {
  function visualBasic(rects: Rect[]): string {
    const names = rects.map((_, index) => `Sheet ${index + 1}`);
    return basic(
      rects
        .map((rect, index) => zone(index + 2, rect, `type-v2="visual" name="${names[index]}"`))
        .join(''),
    )
      .replace('type-v2="layout-basic"', 'type-v2="layout-basic" layout-strategy-id="flow"')
      .replace(
        '<workbook>',
        `<workbook><worksheets>${names.map((name) => `<worksheet name="${name}"/>`).join('')}</worksheets>`,
      )
      .replace(
        '<viewpoints/>',
        `<viewpoints>${names.map((name) => `<viewpoint name="${name}"/>`).join('')}</viewpoints>`,
      );
  }

  it('rejects the exact off-canvas one-unit managed worksheet probe', () => {
    const expected = flowChildren([
      [0, 0, 100000, 30000],
      [0, 30000, 100000, 70000],
    ]);
    const actual = flowChildren([
      [0, 0, 100000, 30000],
      [-999999, 999999, 1, 1],
    ]);
    expect(verify(expected, actual)).toBe(false);
  });

  it('normalizes direct visual children of a Basic layout carrying the shipped flow hint', () => {
    const expected = visualBasic([[1000, 1000, 98000, 98000]]);
    expect(verify(expected, expected)).toBe(true);
    expect(verify(expected, visualBasic([full]))).toBe(true);
    expect(verify(expected, visualBasic([full]).replace(' layout-strategy-id="flow"', ''))).toBe(
      true,
    );
  });

  it('retains Basic sibling relationships when a flow strategy hint is ignored natively', () => {
    const expected = visualBasic([
      [0, 0, 50000, 100000],
      [50000, 0, 50000, 100000],
    ]);
    const redistributed = visualBasic([
      [0, 0, 10000, 100000],
      [10000, 0, 90000, 100000],
    ]);
    expect(verify(expected, expected)).toBe(true);
    expect(verify(expected, redistributed)).toBe(false);
  });

  it('rejects an actual-only nondefault layout-strategy-id on Flow', () => {
    const expected = flowChildren([
      [0, 0, 100000, 30000],
      [0, 30000, 100000, 70000],
    ]);
    const actual = expected.replace('id="1"', 'id="1" layout-strategy-id="distribute-evenly"');
    expect(verify(expected, actual)).toBe(false);
  });

  it('accepts native omission of the default Flow strategy hint during reflow', () => {
    const expected = flowChildren([
      [0, 0, 100000, 30000],
      [0, 30000, 100000, 70000],
    ]).replace('id="1"', 'id="1" layout-strategy-id="flow"');
    const actual = flowChildren([
      [0, 0, 100000, 50000],
      [0, 50000, 100000, 50000],
    ]);
    expect(verify(expected, actual)).toBe(true);
  });

  it('requires unchanged geometry for a Flow with an unsupported native strategy', () => {
    const hint = (xml: string): string =>
      xml.replace('id="1"', 'id="1" layout-strategy-id="distribute-evenly"');
    const expected = hint(
      flowChildren([
        [0, 0, 100000, 30000],
        [0, 30000, 100000, 70000],
      ]),
    );
    const actual = hint(
      flowChildren([
        [0, 0, 100000, 10000],
        [0, 10000, 100000, 90000],
      ]),
    );
    expect(verify(expected, expected)).toBe(true);
    expect(verify(expected, actual)).toBe(false);
    expect(verify(expected, expected.replace(' layout-strategy-id="distribute-evenly"', ''))).toBe(
      false,
    );
    expect(
      verify(
        expected,
        expected.replace('layout-strategy-id="distribute-evenly"', 'layout-strategy-id="flow"'),
      ),
    ).toBe(false);
  });
});
