import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { Ok } from 'ts-results-es';

import { makeExecutorMock } from '../externalApi/executor.mock.js';
import { runValidation } from '../validation/registry.js';
import {
  composeDashboardWorkbook,
  createDashboardReadbackVerifier,
} from './dashboardViewpoints.js';
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
      vi.useFakeTimers();
      const metrics = [metricFor(type), metricFor(type), undefined];
      const expected = render([300, 600, 100], metrics);
      const actual = render(accepted ? [450, 450, 100] : [400, 500, 100], metrics);
      const xml = fragment(expected);
      expect(runValidation(xml, 'dashboard').valid).toBe(true);
      expect(runValidation(fragment(actual), 'dashboard').valid).toBe(true);
      const composed = composeDashboardWorkbook(expected, 'D', xml).unwrap().xml;
      expect(createDashboardReadbackVerifier(composed, 'D')(actual)).toBe(accepted);
      let live = expected;
      const instanceId = 'shared-allocation-instance';
      const executor = makeExecutorMock({
        desktopApiVersion: '0.2.24',
        listDashboards: vi
          .fn()
          .mockResolvedValue(Ok({ dashboards: [{ id: 'dash-1', name: 'D' }] })),
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
        expect(result.unwrap().verifiedWorksheetNames).toEqual(['Sheet 0', 'Sheet 1']);
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
      vi.useFakeTimers();
      const sizes = accepted ? [10, 54, 936] : [10, 32, 958];
      const expected = render(sizes, manualLastMetrics, { crossInset: 10 });
      const actual = render(sizes, manualLastMetrics);
      const xml = fragment(expected);
      expect(runValidation(xml, 'dashboard').valid).toBe(true);
      expect(runValidation(fragment(actual), 'dashboard').valid).toBe(true);
      const composed = composeDashboardWorkbook(expected, 'D', xml).unwrap().xml;
      expect(createDashboardReadbackVerifier(composed, 'D')(actual)).toBe(accepted);
      let live = expected;
      const instanceId = 'manual-last-budget-instance';
      const executor = makeExecutorMock({
        desktopApiVersion: '0.2.24',
        listDashboards: vi
          .fn()
          .mockResolvedValue(Ok({ dashboards: [{ id: 'dash-1', name: 'D' }] })),
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
        expect(result.unwrap().verifiedWorksheetNames).toEqual(['Sheet 1', 'Sheet 2']);
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
    },
  );
});
