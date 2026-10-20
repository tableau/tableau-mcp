import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import type { MockInstance } from 'vitest';

import * as loadDashboardXmlModule from '../../../../desktop/wrappers/loadDashboardXml.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { mockCacheFileArgsFromFs } from '../../api/applyPreamble.testUtils.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getBuildAndApplyDashboardTool } from './buildAndApplyDashboard.js';

vi.mock('../../../../desktop/cachePath.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../desktop/cachePath.js')>()),
  resolveCacheFileArg: vi.fn(),
  readCacheFileArg: vi.fn(),
  checkCacheFileArg: vi.fn(),
  writeCacheFileArg: vi.fn(),
}));
vi.mock('../../../../desktop/wrappers/getWorkbookXml.js');
vi.mock('../../../../desktop/wrappers/loadWorkbookXml.js');
vi.mock('../../../../desktop/wrappers/loadDashboardXml.js');
vi.mock('../../../../desktop/wrappers/injectViewpoints.js');
vi.mock('fs');

type Layout = {
  kpis: string[];
  charts: string[];
  layoutType: 'auto-grid' | 'rows' | 'columns' | 'custom';
  gridColumns?: number;
  kpiStripHeight?: number;
  customZones?: { worksheetName: string; x: number; y: number; width: number; height: number }[];
};

async function run(layoutSpec: Layout, title?: string): Promise<CallToolResult> {
  const tool = getBuildAndApplyDashboardTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const extra = { ...getMockRequestHandlerExtra(), getExecutor: vi.fn().mockResolvedValue({}) };
  return await callback(
    {
      session: '12345',
      dashboardName: 'D',
      dashboardFile: '/path/dashboard.xml',
      workbookFile: '/path/workbook.xml',
      title,
      layoutSpec,
      worksheetNames: [...layoutSpec.kpis, ...layoutSpec.charts],
    },
    extra,
  );
}

type CustomZone = NonNullable<Layout['customZones']>[number];

const zone = (worksheetName: string, over: Partial<CustomZone> = {}): CustomZone => ({
  worksheetName,
  x: 0,
  y: 0,
  width: 50000,
  height: 50000,
  ...over,
});

describe('build-and-apply-dashboard layout validation', () => {
  let load: MockInstance<typeof loadDashboardXmlModule.loadDashboardXml>;

  beforeEach(() => {
    mockCacheFileArgsFromFs();
    vi.clearAllMocks();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<cached/>');
    load = vi
      .spyOn(loadDashboardXmlModule, 'loadDashboardXml')
      .mockResolvedValue(
        Ok({ validationWarnings: [], documentWarnings: [], verifiedWorksheetNames: ['A', 'B'] }),
      );
  });

  async function expectRefusal(layoutSpec: Layout, pattern: RegExp, title?: string): Promise<void> {
    const result = await run(layoutSpec, title);
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toMatch(pattern);
    expect(load).not.toHaveBeenCalled();
  }

  it('rounds fractional custom zones to integers before the write', async () => {
    const result = await run({
      kpis: [],
      charts: ['A', 'B'],
      layoutType: 'custom',
      customZones: [
        zone('A', { width: 33333.3, height: 49999.6 }),
        zone('B', { x: 33333.3, width: 66666.7 }),
      ],
    });
    expect(result.isError).toBe(false);
    const xml = (load.mock.calls[0][0] as { xml: string }).xml;
    expect(xml).toContain('w="33333"');
    expect(xml).toContain('h="50000"');
    expect(xml).toContain('x="33333"');
    expect(xml).toContain('w="66667"');
    expect(xml).not.toMatch(/(?:x|y|w|h)="\d+\.\d+"/);
  });

  it.each([0, 7, 2.5, Number.NaN])(
    'refuses gridColumns %s before any write',
    async (gridColumns) => {
      await expectRefusal(
        { kpis: [], charts: ['A', 'B'], layoutType: 'auto-grid', gridColumns },
        /gridColumns/,
      );
    },
  );

  it.each([-1, 101])('refuses kpiStripHeight %s before any write', async (kpiStripHeight) => {
    await expectRefusal(
      { kpis: ['A'], charts: ['B'], layoutType: 'auto-grid', kpiStripHeight },
      /kpiStripHeight/,
    );
  });

  it.each([
    ['negative x', { x: -1 }],
    ['x past the canvas', { x: 100001 }],
    ['x+width past the canvas', { x: 60000, width: 50000 }],
    ['y+height past the canvas', { y: 60000, height: 50000 }],
  ])('refuses a custom zone with %s', async (_label, over) => {
    await expectRefusal(
      { kpis: [], charts: ['A'], layoutType: 'custom', customZones: [zone('A', over)] },
      /Custom zone "A"/,
    );
  });

  it('refuses custom layout with no customZones', async () => {
    await expectRefusal({ kpis: [], charts: ['A'], layoutType: 'custom' }, /requires customZones/);
  });

  it('names a chart that has no customZone', async () => {
    await expectRefusal(
      { kpis: [], charts: ['A', 'B'], layoutType: 'custom', customZones: [zone('A')] },
      /no customZone for chart\(s\): "B"/,
    );
  });

  it('names a customZone whose sheet is not in charts', async () => {
    await expectRefusal(
      {
        kpis: [],
        charts: ['A'],
        layoutType: 'custom',
        customZones: [zone('A'), zone('Ghost', { x: 50000 })],
      },
      /not in charts: "Ghost"/,
    );
  });

  it('refuses when the title and KPI strip leave no chart area', async () => {
    await expectRefusal(
      { kpis: ['K'], charts: ['A'], layoutType: 'rows', kpiStripHeight: 95 },
      /leave no room for the charts/,
      'Sales',
    );
  });

  it('refuses a custom zone that rounds to zero size', async () => {
    await expectRefusal(
      {
        kpis: [],
        charts: ['A'],
        layoutType: 'custom',
        customZones: [zone('A', { width: 0.4 })],
      },
      /width and height at least 1/,
    );
  });

  it('refuses a worksheet named twice in customZones', async () => {
    await expectRefusal(
      {
        kpis: [],
        charts: ['A'],
        layoutType: 'custom',
        customZones: [zone('A'), zone('A', { x: 50000 })],
      },
      /more than once: "A"/,
    );
  });

  it('refuses a sheet named twice in charts, or in kpis and charts', async () => {
    await expectRefusal(
      { kpis: [], charts: ['A', 'A'], layoutType: 'rows' },
      /more than once in kpis and charts: "A"/,
    );
    await expectRefusal(
      { kpis: ['A'], charts: ['A'], layoutType: 'rows' },
      /more than once in kpis and charts: "A"/,
    );
  });

  it('refuses a customZone for a KPI sheet with KPI text', async () => {
    await expectRefusal(
      {
        kpis: ['K'],
        charts: ['A'],
        layoutType: 'custom',
        customZones: [zone('A'), zone('K', { x: 50000 })],
      },
      /"K" is a KPI; KPIs always go in the KPI strip, so drop its customZone\./,
    );
  });

  it('does not validate fields the chosen layout ignores', async () => {
    const result = await run({
      kpis: [],
      charts: ['A', 'B'],
      layoutType: 'rows',
      gridColumns: 0,
      customZones: [zone('Ghost', { width: 0 })],
    });
    expect(result.isError).toBe(false);
  });

  it('refuses kpiStripHeight 0 when kpis are given, but not when there are none', async () => {
    await expectRefusal(
      { kpis: ['K'], charts: ['A'], layoutType: 'rows', kpiStripHeight: 0 },
      /kpiStripHeight must be above 0 when kpis are given/,
    );
    const ok = await run({ kpis: [], charts: ['A'], layoutType: 'rows', kpiStripHeight: 0 });
    expect(ok.isError).toBe(false);
  });

  it('advises lowering kpiStripHeight only when that would leave room', async () => {
    await expectRefusal(
      { kpis: ['K'], charts: ['A'], layoutType: 'rows', kpiStripHeight: 95 },
      /Lower kpiStripHeight/,
      'Sales',
    );
  });

  it('does not mention charts or kpiStripHeight when there are no charts', async () => {
    const kpis = Array.from({ length: 100001 }, (_, i) => `K${i}`);
    const result = await run({ kpis, charts: [], layoutType: 'rows' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toMatch(/The KPI strip does not fit on the canvas/);
    expect(result.content[0].text).not.toMatch(/charts|kpiStripHeight|title/i);
    expect(result.content[0].text).toMatch(/Use fewer KPIs\./);
  });

  it('does not offer kpiStripHeight when even a 1% strip leaves no room', async () => {
    const charts = Array.from({ length: 95000 }, (_, i) => `C${i}`);
    const result = await run({ kpis: ['K'], charts, layoutType: 'rows' }, 'Sales');
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toMatch(/Drop the title or use fewer sheets/);
    expect(result.content[0].text).not.toMatch(/Lower kpiStripHeight/);
  });

  it('accepts a KPI-only custom dashboard with no customZones', async () => {
    const result = await run({ kpis: ['A', 'B'], charts: [], layoutType: 'custom' });
    expect(result.isError).toBe(false);
  });

  it('names only the KPI strip when there is no title', async () => {
    const result = await run({
      kpis: ['K'],
      charts: ['A'],
      layoutType: 'rows',
      kpiStripHeight: 100,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toMatch(/The KPI strip leaves no room for the charts/);
    expect(result.content[0].text).toMatch(/Lower kpiStripHeight\./);
    expect(result.content[0].text).not.toMatch(/title/i);
  });

  it('names only the title when there are no KPIs', async () => {
    const charts = Array.from({ length: 95000 }, (_, i) => `C${i}`);
    const result = await run({ kpis: [], charts, layoutType: 'rows' }, 'Sales');
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toMatch(/The title leaves no room for the charts/);
    expect(result.content[0].text).toMatch(/Drop the title or use fewer sheets\./);
    expect(result.content[0].text).not.toMatch(/KPI/);
  });

  it('says the charts do not fit when there is no title and no KPIs', async () => {
    const charts = Array.from({ length: 100001 }, (_, i) => `C${i}`);
    const result = await run({ kpis: [], charts, layoutType: 'rows' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toMatch(/The charts do not fit on the canvas/);
    expect(result.content[0].text).toMatch(/Use fewer sheets\./);
    expect(result.content[0].text).not.toMatch(/title|KPI/i);
  });
});
