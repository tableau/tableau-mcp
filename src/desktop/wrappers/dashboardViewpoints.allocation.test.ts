import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { Ok } from 'ts-results-es';

import { makeExecutorMock } from '../externalApi/executor.mock.js';
import { runValidation } from '../validation/registry.js';
import { createDashboardReadbackVerifier } from './dashboardReflowFixtures.js';
import { composeDashboardWorkbook } from './dashboardViewpoints.js';
import { loadDashboardXml } from './loadDashboardXml.js';

type Metric = {
  type: 'fixed' | 'bounded' | 'unbounded';
  initial: number;
  manual?: number;
};

const spacing =
  '<zone-style><format attr="margin" value="0"/><format attr="padding" value="0"/><format attr="border-width" value="0"/></zone-style>';

function fragment(xml: string): string {
  return new XMLSerializer().serializeToString(
    new DOMParser().parseFromString(xml, 'text/xml').getElementsByTagName('dashboard')[0],
  );
}

async function verifyAppliedAllocation(
  expected: string,
  actual: string,
  accepted: boolean,
  worksheetNames: string[],
): Promise<void> {
  vi.useFakeTimers();
  const xml = fragment(expected);
  expect(runValidation(xml, 'dashboard').valid).toBe(true);
  expect(runValidation(fragment(actual), 'dashboard').valid).toBe(true);
  const composed = composeDashboardWorkbook(expected, 'D', xml).unwrap().xml;
  expect(createDashboardReadbackVerifier(composed, 'D')(actual)).toBe(accepted);
  let live = expected;
  const instanceId = 'allocation-instance';
  const executor = makeExecutorMock({
    desktopApiVersion: '0.2.24',
    listDashboards: vi.fn().mockResolvedValue(Ok({ dashboards: [{ id: 'dash-1', name: 'D' }] })),
    getDashboardDocument: vi.fn().mockResolvedValue(Ok({ xml })),
    getWorkbookDocument: vi.fn().mockImplementation(async () => Ok({ xml: live, instanceId })),
    applyDashboardDocument: vi.fn().mockImplementation(async () => {
      live = actual;
      return Ok({ command_id: 'apply', status: 'completed', submitted_at: '' });
    }),
  });
  const signal = new AbortController().signal;
  const pending = loadDashboardXml({
    dashboardName: 'D',
    xml,
    requireExistingSheet: true,
    verifyReadback: true,
    focus: { navigate: 'none', reason: 'intermediate-leg' },
    executor,
    signal,
  });
  await vi.runAllTimersAsync();
  const result = await pending;
  if (accepted) {
    expect(result.unwrap().verifiedWorksheetNames).toEqual(worksheetNames);
  } else {
    expect(result).toMatchObject({ error: { error: { type: 'verification-failed' } } });
  }
  expect(executor.applyDashboardDocument).toHaveBeenCalledExactlyOnceWith(
    'dash-1',
    expect.any(String),
    signal,
    { expectedInstanceId: instanceId },
  );
  expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
}

describe.each(
  (['vert', 'horz'] as const).flatMap((axis) => [false, true].map((pixels) => ({ axis, pixels }))),
)('shared $axis allocations with unknown metrics (pixels=$pixels)', ({ axis, pixels }) => {
  function render(
    sizes: number[],
    metrics: (Metric | undefined)[],
    { crossInset = 0, extraUnits = 0, lastExtra = 0 } = {},
  ): string {
    const scale = pixels ? 1 : 100;
    const length = 1000 * scale;
    const names: string[] = [];
    let offset = 0;
    const children = sizes.map((size, index) => {
      const metric = metrics[index];
      const primary = Math.round(size * scale) + (index === sizes.length - 1 ? lastExtra : 0);
      const inset = metric?.manual === undefined ? crossInset * scale : 0;
      const [x, y, w, h] =
        axis === 'vert'
          ? [inset, offset, length - 2 * inset, primary]
          : [offset, inset, primary, length - 2 * inset];
      offset += primary;
      let content = '<formatted-text><run>Title</run></formatted-text>';
      let attributes = 'type-v2="text"';
      if (metric) {
        const name = `Sheet ${index}`;
        names.push(name);
        attributes = `type-v2="visual" name="${name}"`;
        if (metric.manual !== undefined)
          attributes += ` is-fixed="true" fixed-size="${metric.manual}"`;
        content =
          metric.type === 'fixed'
            ? `<layout-cache type-w="fixed" type-h="fixed" fixed-size-w="${metric.initial}" fixed-size-h="${metric.initial}"/>`
            : `<layout-cache type-w="scalable" type-h="scalable" minwidth="${metric.initial}" minheight="${metric.initial}" has-max-size-w="${metric.type === 'bounded'}" has-max-size-h="${metric.type === 'bounded'}" maxwidth="${metric.initial + 1000}" maxheight="${metric.initial + 1000}"/>`;
      }
      return `<zone id="${index + 2}" x="${x}" y="${y}" w="${w}" h="${h}" ${attributes}>${content}${spacing}</zone>`;
    });
    return `<workbook><worksheets>${names.map((name) => `<worksheet name="${name}"><table><rows/><cols/></table></worksheet>`).join('')}</worksheets>
      <dashboards><dashboard name="D"><size minwidth="1000" maxwidth="1000" minheight="1000" maxheight="1000"/>
        <zones${pixels ? ' is-pixels="true"' : ''}><zone id="1" type-v2="layout-flow" param="${axis}" x="0" y="0" w="${length + (axis === 'horz' ? extraUnits : 0)}" h="${length + (axis === 'vert' ? extraUnits : 0)}">${children.join('')}${spacing}</zone></zones>
      </dashboard></dashboards><windows><window class="dashboard" name="D"><viewpoints>${names.map((name) => `<viewpoint name="${name}"/>`).join('')}</viewpoints></window></windows></workbook>`;
  }

  const kinds = ['fixed', 'bounded', 'unbounded'] as const;
  const metricFor = (type: Metric['type']): Metric => ({
    type,
    initial: type === 'unbounded' ? 100 : 1000,
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(kinds.flatMap((type) => [0, 1, 2].map((unknownIndex) => ({ type, unknownIndex }))))(
    'requires shared allocation for $type siblings with the unknown tile at $unknownIndex',
    ({ type, unknownIndex }) => {
      const metrics: (Metric | undefined)[] = [metricFor(type), metricFor(type)];
      const authored = [300, 600];
      const native = [450, 450];
      const corrupted = [400, 500];
      metrics.splice(unknownIndex, 0, undefined);
      authored.splice(unknownIndex, 0, 100);
      native.splice(unknownIndex, 0, 100);
      corrupted.splice(unknownIndex, 0, 100);
      const expected = render(authored, metrics);
      const matches = createDashboardReadbackVerifier(expected, 'D');
      expect(matches(expected)).toBe(true);
      expect(matches(render(native, metrics))).toBe(true);
      expect(matches(render(corrupted, metrics))).toBe(false);
      const crossOnly = render(corrupted, metrics, { crossInset: 10 });
      expect(createDashboardReadbackVerifier(crossOnly, 'D')(render(corrupted, metrics))).toBe(
        false,
      );
    },
  );

  it.each(kinds.flatMap((type) => [false, true].map((accepted) => ({ type, accepted }))))(
    'verifies the composed expectation and original-instance apply for $type (accepted=$accepted)',
    async ({ type, accepted }) => {
      const metrics = [metricFor(type), metricFor(type), undefined];
      const expected = render([300, 600, 100], metrics);
      const actual = render(accepted ? [450, 450, 100] : [400, 500, 100], metrics);
      await verifyAppliedAllocation(expected, actual, accepted, ['Sheet 0', 'Sheet 1']);
    },
  );

  it('grows unequal minima by the same extra allocation', () => {
    const metrics: (Metric | undefined)[] = [
      { type: 'unbounded', initial: 100 },
      { type: 'unbounded', initial: 300 },
      undefined,
    ];
    const matches = createDashboardReadbackVerifier(render([300, 600, 100], metrics), 'D');
    expect(matches(render([350, 550, 100], metrics))).toBe(true);
    expect(matches(render([400, 500, 100], metrics))).toBe(false);
  });

  it('preserves smaller initial sizes while the other known tile is capped', () => {
    const metrics: (Metric | undefined)[] = [
      { type: 'fixed', initial: 300 },
      { type: 'fixed', initial: 1000 },
      undefined,
    ];
    const matches = createDashboardReadbackVerifier(render([400, 400, 200], metrics), 'D');
    expect(matches(render([300, 500, 200], metrics))).toBe(true);
  });

  it('uses a shared cap for different oversubscribed initial sizes', () => {
    const metrics: (Metric | undefined)[] = [
      { type: 'fixed', initial: 1000 },
      { type: 'fixed', initial: 1200 },
      undefined,
    ];
    const matches = createDashboardReadbackVerifier(render([300, 600, 100], metrics), 'D');
    expect(matches(render([450, 450, 100], metrics))).toBe(true);
    expect(matches(render([400, 500, 100], metrics))).toBe(false);
  });

  it('checks the common cap against unknown siblings without assuming their initial metrics', () => {
    const metrics: (Metric | undefined)[] = [
      { type: 'fixed', initial: 1000 },
      undefined,
      undefined,
      undefined,
    ];
    const matches = createDashboardReadbackVerifier(render([250, 250, 250, 250], metrics), 'D');
    expect(matches(render([400, 400, 100, 100], metrics))).toBe(true);
    expect(matches(render([400, 500, 50, 50], metrics))).toBe(false);
  });

  it('retains the integer shrink remainder on the last known tile', () => {
    const metrics: (Metric | undefined)[] = [metricFor('fixed'), undefined, metricFor('fixed')];
    const options = { extraUnits: 1, lastExtra: 1 };
    const matches = createDashboardReadbackVerifier(render([300, 100, 600], metrics, options), 'D');
    expect(matches(render([450, 100, 450], metrics, options))).toBe(true);
    expect(matches(render([400, 100, 500], metrics, options))).toBe(false);
  });

  it('retains the unused integer Grow remainder', () => {
    const metrics: (Metric | undefined)[] = [
      metricFor('unbounded'),
      metricFor('unbounded'),
      undefined,
    ];
    const expected = render([450, 450, 100], metrics, { extraUnits: 1, crossInset: 10 });
    expect(
      createDashboardReadbackVerifier(
        expected,
        'D',
      )(render([450, 450, 100], metrics, { extraUnits: 1 })),
    ).toBe(true);
  });

  it('retains final residual allocation when a positive manual request is capped', () => {
    const metrics: (Metric | undefined)[] = [
      { type: 'fixed', initial: 1200, manual: 1200 },
      { type: 'fixed', initial: 10 },
      undefined,
      { type: 'fixed', initial: 10 },
    ];
    const expected = render([904, 10, 10, 76], metrics, { crossInset: 10 });
    expect(createDashboardReadbackVerifier(expected, 'D')(render([904, 10, 10, 76], metrics))).toBe(
      true,
    );
  });

  it('retains final scalable residual allocation from zero-request manual fallback', () => {
    const metrics: (Metric | undefined)[] = [
      { type: 'unbounded', initial: 800, manual: 0 },
      { type: 'unbounded', initial: 100 },
      undefined,
      { type: 'unbounded', initial: 100 },
    ];
    const expected = render([0, 100, 100, 800], metrics, { crossInset: 10 });
    expect(
      createDashboardReadbackVerifier(expected, 'D')(render([0, 100, 100, 800], metrics)),
    ).toBe(true);
  });

  const manualLastMetrics: (Metric | undefined)[] = [
    undefined,
    { type: 'fixed', initial: 100 },
    { type: 'fixed', initial: 1200, manual: 1200 },
  ];

  it('rejects manufactured final manual residual when an automatic tile is capped', () => {
    const expected = render([10, 32, 958], manualLastMetrics, { crossInset: 10 });
    expect(createDashboardReadbackVerifier(expected, 'D')(expected)).toBe(true);
    expect(
      createDashboardReadbackVerifier(expected, 'D')(render([10, 32, 958], manualLastMetrics)),
    ).toBe(false);
    const native = render([10, 54, 936], manualLastMetrics);
    expect(
      createDashboardReadbackVerifier(
        render([10, 54, 936], manualLastMetrics, { crossInset: 10 }),
        'D',
      )(native),
    ).toBe(true);
  });

  it.each([false, true])(
    'verifies final manual allocation after the automatic cap fills its budget (accepted=%s)',
    async (accepted) => {
      const sizes = accepted ? [10, 54, 936] : [10, 32, 958];
      const expected = render(sizes, manualLastMetrics, { crossInset: 10 });
      const actual = render(sizes, manualLastMetrics);
      await verifyAppliedAllocation(expected, actual, accepted, ['Sheet 1', 'Sheet 2']);
    },
  );

  const growingMetrics: (Metric | undefined)[] = [
    { type: 'unbounded', initial: 100 },
    { type: 'fixed', initial: 100 },
    { type: 'fixed', initial: 100 },
    undefined,
  ];
  const shrinkingMetrics: (Metric | undefined)[] = [
    { type: 'fixed', initial: 1200, manual: 1200 },
    undefined,
    { type: 'fixed', initial: 10 },
  ];
  const retainedCases = [
    {
      name: 'unused Grow budget',
      sizes: [200, 100, 100, 100],
      metrics: growingMetrics,
      accepted: false,
    },
    {
      name: 'native Grow budget',
      sizes: [700, 100, 100, 100],
      metrics: growingMetrics,
      accepted: true,
    },
    {
      name: 'unused Shrink budget',
      sizes: [936, 10, 10],
      metrics: shrinkingMetrics,
      accepted: false,
    },
    {
      name: 'native Shrink budget',
      sizes: [936, 10, 54],
      metrics: shrinkingMetrics,
      accepted: true,
    },
    {
      name: 'readback-only Grow fill requirement',
      sizes: [200, 100, 100, 100],
      metrics: growingMetrics,
      accepted: false,
      omitFirstCache: true,
    },
    {
      name: 'fixed-only trailing space',
      sizes: [100, 100, 100],
      metrics: [{ type: 'fixed', initial: 100 }, undefined, { type: 'fixed', initial: 100 }],
      accepted: true,
    },
    {
      name: 'bounded trailing space',
      sizes: [100, 100],
      metrics: [{ type: 'bounded', initial: 100 }, undefined],
      accepted: true,
    },
    {
      name: 'unknown singleton horizontal fill requirement',
      sizes: [100],
      metrics: [undefined],
      accepted: axis === 'vert',
    },
    {
      name: 'native rounding onto the last manual tile',
      sizes: [5, pixels ? 45 : 45.5, pixels ? 45 : 45.5, pixels ? 905 : 904],
      metrics: [
        undefined,
        { type: 'fixed', initial: 100 },
        { type: 'fixed', initial: 100 },
        { type: 'fixed', initial: 1200, manual: 1200 },
      ],
      accepted: true,
    },
    ...[0, 1, 2, 3].map((units) => ({
      name: `${units}-unit final manual residual`,
      sizes: [10, 54 - units / (pixels ? 1 : 100), 936 + units / (pixels ? 1 : 100)],
      metrics: manualLastMetrics,
      accepted: units <= 1,
    })),
  ] satisfies {
    name: string;
    sizes: number[];
    metrics: (Metric | undefined)[];
    accepted: boolean;
    omitFirstCache?: boolean;
  }[];

  it.each(retainedCases)(
    'checks $name during cross-only reflow',
    async ({ sizes, metrics, accepted, ...options }) => {
      let expected = render(sizes, metrics, { crossInset: 10 });
      if ('omitFirstCache' in options && options.omitFirstCache)
        expected = expected.replace(/<layout-cache[^>]*\/>/, '');
      const actual = render(sizes, metrics);
      const matches = createDashboardReadbackVerifier(expected, 'D');
      expect(matches(expected)).toBe(true);
      expect(matches(actual)).toBe(accepted);
      await verifyAppliedAllocation(
        expected,
        actual,
        accepted,
        metrics.flatMap((metric, index) => (metric ? [`Sheet ${index}`] : [])),
      );
    },
  );

  const nativeDefaultSizes = axis === 'vert' ? [550, 350, 100] : [466, 266, 268];
  const parsedZeroSizes = [400, 500, 100];
  const defaultMinimumCases = [
    {
      name: 'omitted native default',
      submitted: null,
      readback: null,
      sizes: nativeDefaultSizes,
      accepted: true,
    },
    {
      name: 'explicit readback default',
      submitted: null,
      readback: 300,
      sizes: nativeDefaultSizes,
      accepted: true,
    },
    {
      name: 'explicit native default',
      submitted: 300,
      readback: 300,
      sizes: nativeDefaultSizes,
      accepted: true,
    },
    {
      name: 'explicit zero is not a native default',
      submitted: 0,
      readback: 0,
      sizes: nativeDefaultSizes,
      accepted: false,
    },
    {
      name: 'readback zero is not a native default',
      submitted: null,
      readback: 0,
      sizes: nativeDefaultSizes,
      accepted: false,
    },
    {
      name: 'omitted readback default excludes parsed zero',
      submitted: null,
      readback: null,
      sizes: parsedZeroSizes,
      accepted: false,
    },
    {
      name: 'explicit readback default excludes parsed zero',
      submitted: null,
      readback: 300,
      sizes: parsedZeroSizes,
      accepted: false,
    },
    {
      name: 'readback preserves parsed zero',
      submitted: null,
      readback: 0,
      sizes: parsedZeroSizes,
      accepted: true,
    },
    {
      name: 'explicit zero remains supported',
      submitted: 0,
      readback: 0,
      sizes: parsedZeroSizes,
      accepted: true,
    },
    {
      name: 'corrupted shared growth with an omitted default',
      submitted: null,
      readback: null,
      sizes: [nativeDefaultSizes[0] - 50, nativeDefaultSizes[1] + 50, nativeDefaultSizes[2]],
      accepted: false,
    },
  ];
  it.each(
    defaultMinimumCases.flatMap((testCase) =>
      [undefined, 0].map((manual) => ({ ...testCase, manual })),
    ),
  )(
    'checks $name during native reflow (manual=$manual)',
    async ({ submitted, readback, sizes, accepted, manual }) => {
      const metrics: (Metric | undefined)[] = [
        { type: 'unbounded', initial: 300, ...(manual === undefined ? {} : { manual }) },
        { type: 'unbounded', initial: 100 },
        undefined,
      ];
      const setFirstMinimum = (xml: string, value: number | null): string => {
        const doc = new DOMParser().parseFromString(xml, 'text/xml');
        const cache = doc.getElementsByTagName('layout-cache')[0];
        for (const attribute of ['minwidth', 'minheight']) {
          if (value === null) cache.removeAttribute(attribute);
          else cache.setAttribute(attribute, String(value));
        }
        return new XMLSerializer().serializeToString(doc);
      };
      const expected = setFirstMinimum(render(sizes, metrics, { crossInset: 10 }), submitted);
      const actual = setFirstMinimum(render(sizes, metrics), readback);
      const matches = createDashboardReadbackVerifier(expected, 'D');
      expect(matches(expected)).toBe(true);
      expect(matches(actual)).toBe(accepted);
      await verifyAppliedAllocation(expected, actual, accepted, ['Sheet 0', 'Sheet 1']);
    },
  );

  const refreshedMinimumCases = [
    { name: 'mixed omitted and refreshed minima', first: 300, second: 301, bounded: false },
    { name: 'two refreshed minima', first: 301, second: 401, bounded: false },
    { name: 'refreshed zero and default minima', first: 0, second: 300, bounded: false },
    { name: 'omitted minimum and bound defaults', first: 300, second: 100, bounded: true },
    { name: 'refreshed minimum and bound defaults', first: 301, second: 100, bounded: true },
  ];
  it.each(
    refreshedMinimumCases.flatMap((testCase) =>
      [undefined, 0].map((manual) => ({ ...testCase, manual })),
    ),
  )(
    'uses consistent cache defaults for $name (manual=$manual)',
    async ({ first, second, bounded, manual }) => {
      const metrics: (Metric | undefined)[] = [
        {
          type: bounded ? 'bounded' : 'unbounded',
          initial: first,
          ...(manual === undefined ? {} : { manual }),
        },
        { type: 'unbounded', initial: second },
        undefined,
      ];
      const scale = pixels ? 1 : 100;
      const extra = Math.floor(((900 - first - second) * scale) / (bounded ? 1 : 2)) / scale;
      const sizes = [first + (bounded ? 0 : extra), second + extra, 100];
      const configure = (xml: string, submitted: boolean): string => {
        const doc = new DOMParser().parseFromString(xml, 'text/xml');
        Array.from(doc.getElementsByTagName('layout-cache')).forEach((cache, index) => {
          for (const dimension of ['width', 'height']) {
            if (submitted || metrics[index]?.initial === 300)
              cache.removeAttribute(`min${dimension}`);
          }
          if (submitted && index === 0 && bounded) {
            cache.removeAttribute('has-max-size-w');
            cache.removeAttribute('has-max-size-h');
          }
        });
        return new XMLSerializer().serializeToString(doc);
      };
      const expected = configure(render(sizes, metrics, { crossInset: 10 }), true);
      const actual = configure(render(sizes, metrics), false);
      expect(createDashboardReadbackVerifier(expected, 'D')(actual)).toBe(true);
      await verifyAppliedAllocation(expected, actual, true, ['Sheet 0', 'Sheet 1']);
      const corrupted = configure(render([sizes[0] - 20, sizes[1] + 20, sizes[2]], metrics), false);
      expect(createDashboardReadbackVerifier(expected, 'D')(corrupted)).toBe(false);
    },
  );

  it.each(['minwidth', 'minheight', 'has-max-size-w', 'has-max-size-h', 'type-w', 'type-h'])(
    'preserves an authored %s while resolving omitted minima',
    async (attribute) => {
      const metrics: (Metric | undefined)[] = [
        { type: 'unbounded', initial: 300 },
        { type: 'unbounded', initial: 100 },
        undefined,
      ];
      const expected = render([550, 350, 100], metrics, { crossInset: 10 }).replace(
        / min(?:width|height)="300"/g,
        '',
      );
      const doc = new DOMParser().parseFromString(render([550, 350, 100], metrics), 'text/xml');
      const cache = doc.getElementsByTagName('layout-cache')[1];
      cache.setAttribute(
        attribute,
        attribute.startsWith('min') ? '101' : attribute.startsWith('has-') ? 'true' : 'fixed',
      );
      const actual = new XMLSerializer().serializeToString(doc);
      expect(createDashboardReadbackVerifier(expected, 'D')(actual)).toBe(false);
      await verifyAppliedAllocation(expected, actual, false, ['Sheet 0', 'Sheet 1']);
    },
  );

  it('preserves an explicit bound flag when native geometry otherwise matches', async () => {
    const metrics: (Metric | undefined)[] = [
      { type: 'bounded', initial: 300 },
      { type: 'unbounded', initial: 100 },
      undefined,
    ];
    const flag = axis === 'horz' ? 'has-max-size-w' : 'has-max-size-h';
    const omitMinimum = (xml: string): string => xml.replace(/ min(?:width|height)="300"/g, '');
    const expected = omitMinimum(render([300, 600, 100], metrics, { crossInset: 10 })).replace(
      `${flag}="true"`,
      `${flag}="false"`,
    );
    const actual = omitMinimum(render([300, 600, 100], metrics));
    const implicitBound = expected.replace(` ${flag}="false"`, '');
    expect(createDashboardReadbackVerifier(implicitBound, 'D')(actual)).toBe(true);
    expect(createDashboardReadbackVerifier(expected, 'D')(actual)).toBe(false);
    await verifyAppliedAllocation(expected, actual, false, ['Sheet 0', 'Sheet 1']);
  });

  if (axis === 'horz') {
    it.each([
      { viewport: 200, submitted: null, minimum: 300, bounded: true, implicitBound: false },
      { viewport: 1000, submitted: null, minimum: 300, bounded: true, implicitBound: false },
      { viewport: 200, submitted: null, minimum: 301, bounded: true, implicitBound: false },
      { viewport: 200, submitted: 0, minimum: 0, bounded: true, implicitBound: false },
      { viewport: 200, submitted: null, minimum: 300, bounded: false, implicitBound: true },
      { viewport: 1000, submitted: null, minimum: 300, bounded: true, implicitBound: true },
    ])(
      'fits singleton height using the same minimum as primary allocation: %j',
      async ({ viewport, submitted, minimum, bounded, implicitBound }) => {
        const scale = pixels ? 1 : 100;
        const available = pixels ? viewport : 1000;
        const metrics = [{ type: bounded ? 'bounded' : 'unbounded', initial: minimum }] as Metric[];
        const configure = (xml: string, expected: boolean, height?: number): string => {
          const doc = new DOMParser().parseFromString(xml, 'text/xml');
          const size = doc.getElementsByTagName('size')[0];
          size.setAttribute('minwidth', String(viewport));
          size.setAttribute('maxwidth', String(viewport));
          const cache = doc.getElementsByTagName('layout-cache')[0];
          const value = expected ? submitted : minimum === 300 ? null : minimum;
          if (value === null) cache.removeAttribute('minwidth');
          else cache.setAttribute('minwidth', String(value));
          if (expected && implicitBound) cache.removeAttribute('has-max-size-w');
          cache.setAttribute('type-h', 'fixed');
          cache.setAttribute('fixed-size-h', '100');
          if (height !== undefined)
            doc.getElementsByTagName('zone')[1].setAttribute('h', String(height * scale));
          return new XMLSerializer().serializeToString(doc);
        };
        const options = { extraUnits: (available - 1000) * scale };
        const expected = configure(
          render([available / 2], metrics, { ...options, crossInset: 10 }),
          true,
        );
        const nativeHeight = !bounded || minimum > viewport ? 1000 : 100;
        const actual = configure(render([available], metrics, options), false, nativeHeight);
        expect(createDashboardReadbackVerifier(expected, 'D')(actual)).toBe(true);
        await verifyAppliedAllocation(expected, actual, true, ['Sheet 0']);
        const corrupted = configure(
          render([available], metrics, options),
          false,
          nativeHeight === 1000 ? 100 : 1000,
        );
        expect(createDashboardReadbackVerifier(expected, 'D')(corrupted)).toBe(false);
        await verifyAppliedAllocation(expected, corrupted, false, ['Sheet 0']);
      },
    );
  }
});
