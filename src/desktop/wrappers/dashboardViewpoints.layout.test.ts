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

  it('accepts changed primary allocation within the complete client rectangle', () => {
    expect(
      verify(
        expected,
        flowChildren(
          [
            [0, 0, 100000, 10000],
            [0, 10000, 100000, 90000],
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
        [1000, 1000, 98000, 10000],
        [1000, 11000, 98000, 88000],
      ],
      axis,
      10,
    );
    expect(verify(before, after)).toBe(true);
  });

  it('retains legitimate trailing space when all flow children have fixed sizes', () => {
    const cells = [
      zone(3, transpose([0, 0, 100000, 10000], axis), 'type-v2="empty" fixed-size="100"'),
      zone(4, transpose([0, 10000, 100000, 10000], axis), 'type-v2="empty" fixed-size="100"'),
    ].join('');
    const before = basic(flow(2, [1000, 1000, 98000, 98000], cells, axis));
    const after = basic(flow(2, full, cells, axis));
    expect(verify(before, after)).toBe(true);
  });

  it('accepts the native integer-division remainder across six scalable children', () => {
    // FlowMetrics::GrowZones divides remaining PP space by the number of
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
      const axis = ['x', 'w'].includes(coordinate) ? 'horz' : 'vert';
      const movedOrigin = ['x', 'y'].includes(coordinate);
      const render = (changed: boolean): string => {
        const delta = changed ? 100 : 0;
        const first: Rect = [0, 0, 100000, 30000 + (movedOrigin ? delta : 0)];
        const fixed: Rect = [
          0,
          30000 + (movedOrigin ? delta : 0),
          100000,
          40000 + (movedOrigin ? 0 : delta),
        ];
        const last: Rect = [0, 70000 + delta, 100000, 30000 - delta];
        return workbook(
          flow(
            1,
            full,
            [
              zone(2, transpose(first, axis), 'type-v2="empty"'),
              zone(3, transpose(fixed, axis), `type-v2="empty" ${setting}`),
              zone(4, transpose(last, axis), 'type-v2="empty"'),
            ].join(''),
            axis,
          ),
        );
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
    return workbook(
      flow(1, full, zone(2, rect, 'type-v2="empty"', cache + style), 'horz'),
      'minwidth="1000" maxwidth="1000" minheight="800" maxheight="800"',
    );
  }

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
    // (100 + 5 + 7)px * 100000 / 800px = 14000 PP.
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
