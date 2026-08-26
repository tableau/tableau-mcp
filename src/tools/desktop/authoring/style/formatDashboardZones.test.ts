import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import {
  READBACK_POLL_INTERVAL_MS,
  READBACK_POLL_MAX_ATTEMPTS,
} from '../../../../desktop/wrappers/pollReadback.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import {
  formatDashboardZonesDocument,
  getFormatDashboardZonesTool,
} from './formatDashboardZones.js';

const DASHBOARD_XML = `<dashboard name='Executive Overview'>
  <style><style-rule element='dashboard'><format attr='background-color' value='#FFFFFF' /></style-rule></style>
  <zones>
    <zone id='1' name='Sales' type-v2='worksheet'>
      <zone-style><format attr='border-color' value='#AAAAAA' /></zone-style>
    </zone>
    <zone h='5000' id='2' type-v2='layout-basic' w='6000'>
      <zone-style><format attr='corner-radius' value='4' /><format attr='padding' value='8' /></zone-style>
      <zone id='3' name='Profit' type-v2='worksheet'>
        <zone-style><format attr='border-color' value='#BBBBBB' /></zone-style>
      </zone>
    </zone>
    <zone id='4' type-v2='layout-basic'><zone-style /></zone>
  </zones>
  <simple-id uuid='{dashboard-1}' />
</dashboard>`;

const PRODUCTS_DASHBOARD_XML = `<dashboard name='Products'>
  <zones>
    <zone id='9' type-v2='layout-basic'>
      <zone-style><format attr='padding' value='12' /></zone-style>
      <zone id='10' type-v2='text'><zone-style><format attr='font-size' value='18' /></zone-style></zone>
      <zone id='13' type-v2='text'><zone-style><format attr='font-color' value='#222222' /></zone-style></zone>
      <zone id='11' name='Product Sales' type-v2='worksheet'><zone-style><format attr='border-style' value='none' /></zone-style></zone>
      <zone id='12' name='Product Profit' type-v2='worksheet'><zone-style><format attr='border-style' value='none' /></zone-style></zone>
    </zone>
  </zones>
</dashboard>`;

const LIVE_COMPOSED_DASHBOARD_XML = `<dashboard enable-sort-zone-taborder='true' name='Rounded Corners VIP' xmlns:user='http://www.tableausoftware.com/xml/user'>
  <style />
  <size maxheight='1000' maxwidth='1400' minheight='1000' minwidth='1400' sizing-mode='fixed' />
  <zones>
    <zone h='100000' id='9' type-v2='layout-basic' w='100000' x='0' y='0'>
      <zone h='8000' id='10' type-v2='text' w='100000' x='0' y='0'>
        <formatted-text>
          <run bold='true' fontalignment='1' fontsize='16'>Rounded Corners — Profit by Sub-Category</run>
        </formatted-text>
        <zone-style>
          <format attr='border-color' value='#000000' />
          <format attr='border-style' value='none' />
          <format attr='border-width' value='0' />
          <format attr='margin' value='4' />
        </zone-style>
      </zone>
      <zone h='92000' id='11' name='Create a horizontal bar chart of SUM(Profit) by Sub-Category.' w='100000' x='0' y='8000'>
        <zone-style>
          <format attr='border-color' value='#000000' />
          <format attr='border-style' value='none' />
          <format attr='border-width' value='0' />
          <format attr='margin' value='4' />
        </zone-style>
      </zone>
    </zone>
  </zones>
  <simple-id uuid='{4706F991-82FE-4308-8293-0A4250ABD2C9}' />
</dashboard>`;

const LIVE_ROUNDED_DASHBOARD_READBACK_XML = `<dashboard enable-sort-zone-taborder='true' name='Rounded Corners VIP' xmlns:user='http://www.tableausoftware.com/xml/user'>
  <style />
  <size maxheight='1000' maxwidth='1400' minheight='1000' minwidth='1400' sizing-mode='fixed' />
  <zones>
    <zone h='100000' id='9' type-v2='layout-basic' w='100000' x='0' y='0'>
      <zone h='8000' id='10' type-v2='text' w='100000' x='0' y='0'>
        <formatted-text>
          <run bold='true' fontalignment='1' fontsize='16'>Rounded Corners — Profit by Sub-Category</run>
        </formatted-text>
        <zone-style>
          <format attr='border-color' value='#000000' />
          <format attr='border-style' value='none' />
          <format attr='border-width' value='0' />
          <format attr='margin' value='4' />
        </zone-style>
      </zone>
      <zone h='92000' id='11' name='Create a horizontal bar chart of SUM(Profit) by Sub-Category.' w='100000' x='0' y='8000'>
        <zone-style>
          <format attr='border-color' value='#000000' />
          <format attr='border-style' value='none' />
          <format attr='border-width' value='0' />
          <format attr='margin' value='4' />
        </zone-style>
      </zone>
      <zone-style>
        <format attr='border-color' value='#444444' />
        <format attr='border-style' value='none' />
        <format attr='border-width' value='0' />
        <format attr='corner-radius' value='18' />
      </zone-style>
    </zone>
  </zones>
  <simple-id uuid='{4706F991-82FE-4308-8293-0A4250ABD2C9}' />
</dashboard>`;

describe('formatDashboardZonesDocument', () => {
  it('updates only containers, including nested container-owned bytes', () => {
    const result = formatDashboardZonesDocument(DASHBOARD_XML, {
      scope: 'containers',
      cornerRadius: 12,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.targetZoneIds).toEqual(['2', '4']);
    expect(result.xml).toContain(
      "<zone-style><format attr='corner-radius' value='12' /><format attr='padding' value='8' /></zone-style>",
    );
    expect(result.xml).toContain(
      "<zone id='4' type-v2='layout-basic'><zone-style ><format attr='corner-radius' value='12' /></zone-style></zone>",
    );
    expect(result.xml).toContain(
      "<zone id='3' name='Profit' type-v2='worksheet'>\n        <zone-style><format attr='border-color' value='#BBBBBB' /></zone-style>",
    );
    expect(result.xml).toContain(
      "<style><style-rule element='dashboard'><format attr='background-color' value='#FFFFFF' /></style-rule></style>",
    );
  });

  it('targets one nested zone by id without changing its parent', () => {
    const result = formatDashboardZonesDocument(DASHBOARD_XML, {
      scope: 'zone_ids',
      zoneIds: ['3'],
      cornerRadius: 9,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.targetZoneIds).toEqual(['3']);
    expect(result.xml).toContain("<format attr='corner-radius' value='4' />");
    expect(result.xml).toContain(
      "<zone-style><format attr='border-color' value='#BBBBBB' /><format attr='corner-radius' value='9' /></zone-style>",
    );
    expect(result.xml.replace("<format attr='corner-radius' value='9' />", '')).toBe(DASHBOARD_XML);
  });

  it('handles the live Products nested-zone shape without touching nested siblings', () => {
    const containers = formatDashboardZonesDocument(PRODUCTS_DASHBOARD_XML, {
      scope: 'containers',
      cornerRadius: 16,
    });
    expect(containers.ok).toBe(true);
    if (!containers.ok) return;
    expect(containers.targetZoneIds).toEqual(['9']);
    expect(containers.xml).toContain(
      "<zone id='10' type-v2='text'><zone-style><format attr='font-size' value='18' /></zone-style></zone>",
    );
    expect(containers.xml).toContain(
      "<zone id='12' name='Product Profit' type-v2='worksheet'><zone-style><format attr='border-style' value='none' /></zone-style></zone>",
    );

    const all = formatDashboardZonesDocument(PRODUCTS_DASHBOARD_XML, {
      scope: 'all',
      cornerRadius: 16,
    });
    expect(all.ok).toBe(true);
    if (!all.ok) return;
    expect(all.targetZoneIds).toEqual(['9', '10', '13', '11', '12']);
    expect(all.xml.match(/attr='corner-radius' value='16'/g)).toHaveLength(5);
  });

  it('includes a nested layout-flow zone in container scope', () => {
    const source = `<dashboard name='D'>
  <zones>
    <zone id='20' type-v2='layout-basic'>
      <zone id='21' type-v2='layout-flow'>
        <zone id='22' name='Sales' type-v2='worksheet'><zone-style><format attr='margin' value='4' /></zone-style></zone>
        <zone-style><format attr='padding' value='6' /></zone-style>
      </zone>
      <zone-style><format attr='padding' value='8' /></zone-style>
    </zone>
  </zones>
</dashboard>`;
    const result = formatDashboardZonesDocument(source, {
      scope: 'containers',
      cornerRadius: 10,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.targetZoneIds).toEqual(['20', '21']);
    expect(result.xml).toContain(
      "<zone id='21' type-v2='layout-flow'>\n        <zone id='22' name='Sales' type-v2='worksheet'><zone-style><format attr='margin' value='4' /></zone-style></zone>\n        <zone-style><format attr='padding' value='6' /><format attr='corner-radius' value='10' /></zone-style>",
    );
    expect(result.xml).toContain(
      "<zone-style><format attr='padding' value='8' /><format attr='corner-radius' value='10' /></zone-style>",
    );
  });

  it('inserts a missing direct zone-style last, after nested zone content', () => {
    const source =
      "<dashboard name='D'><zones><zone id='7' name='Sales' type-v2='worksheet'><zone id='8' type-v2='worksheet' /></zone></zones></dashboard>";
    const result = formatDashboardZonesDocument(source, {
      scope: 'zone_ids',
      zoneIds: ['7'],
      cornerRadius: 6,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.xml).toBe(
      "<dashboard name='D'><zones><zone id='7' name='Sales' type-v2='worksheet'><zone id='8' type-v2='worksheet' /><zone-style><format attr='corner-radius' value='6' /></zone-style></zone></zones></dashboard>",
    );
  });

  it('updates only the corner-radius value bytes on an existing format tag', () => {
    const source =
      '<dashboard name="D"><zones><zone id="7" type-v2="worksheet"><zone-style><format vendor-keep="yes" value = "4" attr="corner-radius" future-byte="untouched" /></zone-style></zone></zones></dashboard>';
    const result = formatDashboardZonesDocument(source, {
      scope: 'zone_ids',
      zoneIds: ['7'],
      cornerRadius: 23,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.xml).toBe(
      '<dashboard name="D"><zones><zone id="7" type-v2="worksheet"><zone-style><format vendor-keep="yes" value = "23" attr="corner-radius" future-byte="untouched" /></zone-style></zone></zones></dashboard>',
    );
  });

  it('expands a self-closing zone-style without dropping opening-tag attributes', () => {
    const source =
      "<dashboard name='D'><zones><zone id='7' type-v2='worksheet'><zone-style vendor-keep='yes' future-byte=\"untouched\" /></zone></zones></dashboard>";
    const result = formatDashboardZonesDocument(source, {
      scope: 'zone_ids',
      zoneIds: ['7'],
      cornerRadius: 11,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.xml).toBe(
      "<dashboard name='D'><zones><zone id='7' type-v2='worksheet'><zone-style vendor-keep='yes' future-byte=\"untouched\" ><format attr='corner-radius' value='11' /></zone-style></zone></zones></dashboard>",
    );
  });

  it('is byte-identical when every target already has the requested radius', () => {
    const first = formatDashboardZonesDocument(DASHBOARD_XML, {
      scope: 'containers',
      cornerRadius: 12,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = formatDashboardZonesDocument(first.xml, {
      scope: 'containers',
      cornerRadius: 12,
    });

    expect(second).toEqual(first);
  });

  it.each([
    [
      'a missing requested id',
      DASHBOARD_XML,
      { scope: 'zone_ids' as const, zoneIds: ['999'], cornerRadius: 8 },
      '999',
    ],
    [
      'duplicate ids in the document',
      DASHBOARD_XML.replace("id='4'", "id='3'"),
      { scope: 'all' as const, cornerRadius: 8 },
      'duplicate zone id',
    ],
    [
      'a zone without an id',
      DASHBOARD_XML.replace(" id='4'", ''),
      { scope: 'all' as const, cornerRadius: 8 },
      'every zone needs an id',
    ],
    [
      'a target with two direct styles',
      DASHBOARD_XML.replace(
        "<zone id='1' name='Sales' type-v2='worksheet'>",
        "<zone id='1' name='Sales' type-v2='worksheet'><zone-style />",
      ),
      { scope: 'zone_ids' as const, zoneIds: ['1'], cornerRadius: 8 },
      'more than one direct zone-style',
    ],
    [
      'a self-closing target zone',
      "<dashboard name='D'><zones><zone id='7' type-v2='worksheet' /></zones></dashboard>",
      { scope: 'zone_ids' as const, zoneIds: ['7'], cornerRadius: 8 },
      'self-closing',
    ],
    [
      'malformed nested zones',
      "<dashboard name='D'><zones><zone id='1'><zone id='2'></zone></zones></dashboard>",
      { scope: 'all' as const, cornerRadius: 8 },
      'Malformed dashboard',
    ],
    [
      'an out-of-range radius',
      DASHBOARD_XML,
      { scope: 'all' as const, cornerRadius: 101 },
      'integer from 0 to 100',
    ],
  ])('fails closed for %s', (_name, source, request, message) => {
    const result = formatDashboardZonesDocument(source, request);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain(message);
  });
});

describe('format-dashboard-zones tool', () => {
  afterEach(() => vi.useRealTimers());

  it('exposes only a bounded typed schema', () => {
    const tool = getFormatDashboardZonesTool(new DesktopMcpServer());
    expect(tool.name).toBe('format-dashboard-zones');
    expect(Object.keys(tool.paramsSchema)).toEqual([
      'session',
      'dashboardName',
      'cornerRadius',
      'scope',
      'zoneIds',
    ]);
    expect(JSON.stringify(tool.paramsSchema)).not.toMatch(/xml|file/i);
  });

  it('resolves a dashboard id, applies once, and verifies exact target ids', async () => {
    const { result, applyDashboardDocument } = await callTool({
      dashboardName: 'dashboard-1',
      cornerRadius: 14,
      scope: 'containers',
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toEqual({
      dashboard: 'Executive Overview',
      cornerRadius: 14,
      zoneIds: ['2', '4'],
      verified: true,
    });
    expect(applyDashboardDocument).toHaveBeenCalledTimes(1);
  });

  it('rejects duplicate zone ids and invalid scope combinations before any read', async () => {
    const duplicate = await callTool({
      dashboardName: 'Executive Overview',
      cornerRadius: 14,
      scope: 'zone_ids',
      zoneIds: ['2', '2'],
    });
    const ignored = await callTool({
      dashboardName: 'Executive Overview',
      cornerRadius: 14,
      scope: 'all',
      zoneIds: ['2'],
    });

    expect(duplicate.result.isError).toBe(true);
    expect(ignored.result.isError).toBe(true);
    expect(duplicate.getDashboardDocument).not.toHaveBeenCalled();
    expect(ignored.getDashboardDocument).not.toHaveBeenCalled();
  });

  it('skips apply when the target radius already matches', async () => {
    const { result, applyDashboardDocument } = await callTool(
      {
        dashboardName: 'Executive Overview',
        cornerRadius: 4,
        scope: 'zone_ids',
        zoneIds: ['2'],
      },
      { source: DASHBOARD_XML },
    );

    expect(result.isError).toBe(false);
    expect(applyDashboardDocument).not.toHaveBeenCalled();
  });

  it('does not apply stale bytes after the dashboard drifts', async () => {
    const { result, applyDashboardDocument } = await callTool(
      {
        dashboardName: 'Executive Overview',
        cornerRadius: 14,
        scope: 'containers',
      },
      { driftBeforeApply: true },
    );

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('changed while');
    expect(applyDashboardDocument).not.toHaveBeenCalled();
  });

  it('surfaces a readback error after one apply', async () => {
    const { result, applyDashboardDocument } = await callTool(
      {
        dashboardName: 'Executive Overview',
        cornerRadius: 14,
        scope: 'containers',
      },
      { readback: 'error' },
    );

    expect(result.isError).toBe(true);
    expect(applyDashboardDocument).toHaveBeenCalledTimes(1);
  });

  it('rejects document warnings returned by the apply', async () => {
    const { result, applyDashboardDocument } = await callTool(
      {
        dashboardName: 'Executive Overview',
        cornerRadius: 14,
        scope: 'containers',
      },
      { applyDocumentWarning: 'Dropped border formatting from zone 3.' },
    );

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Dropped border formatting from zone 3.');
    expect(applyDashboardDocument).toHaveBeenCalledTimes(1);
  });

  it('fails when readback never settles after one apply', async () => {
    vi.useFakeTimers();
    const resultPromise = callTool(
      {
        dashboardName: 'Executive Overview',
        cornerRadius: 14,
        scope: 'containers',
      },
      { readback: 'unsettled' },
    );
    await vi.advanceTimersByTimeAsync(READBACK_POLL_INTERVAL_MS * READBACK_POLL_MAX_ATTEMPTS);
    const { result, applyDashboardDocument } = await resultPromise;

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('did not survive readback');
    expect(applyDashboardDocument).toHaveBeenCalledTimes(1);
  });

  it('rejects readback that keeps target radii but drops a nested sibling zone', async () => {
    vi.useFakeTimers();
    const resultPromise = callTool(
      {
        dashboardName: 'Executive Overview',
        cornerRadius: 14,
        scope: 'containers',
      },
      { dropNestedZoneOnReadback: true },
    );
    await vi.advanceTimersByTimeAsync(READBACK_POLL_INTERVAL_MS * READBACK_POLL_MAX_ATTEMPTS);
    const { result, applyDashboardDocument } = await resultPromise;

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('dashboard structure');
    expect(applyDashboardDocument).toHaveBeenCalledTimes(1);
  });

  it('rejects readback that keeps target radii and geometry but drops a sibling style', async () => {
    vi.useFakeTimers();
    const resultPromise = callTool(
      {
        dashboardName: 'Executive Overview',
        cornerRadius: 14,
        scope: 'containers',
      },
      { dropSiblingStyleOnReadback: true },
    );
    await vi.advanceTimersByTimeAsync(READBACK_POLL_INTERVAL_MS * READBACK_POLL_MAX_ATTEMPTS);
    const { result, applyDashboardDocument } = await resultPromise;

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('dashboard structure or content');
    expect(applyDashboardDocument).toHaveBeenCalledTimes(1);
  });

  it('accepts semantically identical readback with benign XML reserialization', async () => {
    const { result, applyDashboardDocument } = await callTool(
      {
        dashboardName: 'Executive Overview',
        cornerRadius: 14,
        scope: 'containers',
      },
      { benignReserializationOnReadback: true },
    );

    expect(result.isError).toBe(false);
    expect(applyDashboardDocument).toHaveBeenCalledTimes(1);
  });

  it('holds the shared apply lock until dashboard readback settles', async () => {
    let document = DASHBOARD_XML;
    let readCount = 0;
    let applyCount = 0;
    let releaseFirstReadback!: () => void;
    const firstReadbackGate = new Promise<void>((resolve) => {
      releaseFirstReadback = resolve;
    });
    let reportFirstReadback!: () => void;
    const firstReadbackStarted = new Promise<void>((resolve) => {
      reportFirstReadback = resolve;
    });
    let reportSecondInitialRead!: () => void;
    const secondInitialReadStarted = new Promise<void>((resolve) => {
      reportSecondInitialRead = resolve;
    });
    const getDashboardDocument = vi.fn(async () => {
      readCount += 1;
      if (readCount === 3) {
        reportFirstReadback();
        await firstReadbackGate;
      }
      if (readCount === 4) reportSecondInitialRead();
      return new Ok({ xml: document });
    });
    const applyDashboardDocument = vi.fn(async (_id: string, xml: string) => {
      applyCount += 1;
      document = xml;
      return new Ok({
        command_id: `apply-${applyCount}`,
        status: 'completed',
        result: null,
        warnings: [],
      });
    });
    const executorFunctions = { getDashboardDocument, applyDashboardDocument };

    const first = callTool(
      { dashboardName: 'Executive Overview', cornerRadius: 14, scope: 'containers' },
      { executorFunctions },
    );
    await firstReadbackStarted;
    const second = callTool(
      { dashboardName: 'Executive Overview', cornerRadius: 15, scope: 'containers' },
      { executorFunctions },
    );
    await secondInitialReadStarted;
    await Promise.resolve();
    await Promise.resolve();
    const readsBeforeRelease = getDashboardDocument.mock.calls.length;
    const appliesBeforeRelease = applyDashboardDocument.mock.calls.length;

    releaseFirstReadback();
    const [{ result: firstResult }, { result: secondResult }] = await Promise.all([first, second]);

    expect(readsBeforeRelease).toBe(4);
    expect(appliesBeforeRelease).toBe(1);
    expect(firstResult.isError).toBe(false);
    expect(secondResult.isError).toBe(false);
    expect(getDashboardDocument).toHaveBeenCalledTimes(6);
    expect(applyDashboardDocument).toHaveBeenCalledTimes(2);
  });

  it('accepts the live Desktop normalization of a newly inserted container style', async () => {
    vi.useFakeTimers();
    const resultPromise = callTool(
      {
        dashboardName: 'dashboard-1',
        cornerRadius: 18,
        scope: 'containers',
      },
      {
        source: LIVE_COMPOSED_DASHBOARD_XML,
        readbackXml: LIVE_ROUNDED_DASHBOARD_READBACK_XML,
      },
    );
    await vi.advanceTimersByTimeAsync(READBACK_POLL_INTERVAL_MS * READBACK_POLL_MAX_ATTEMPTS);
    const { result, applyDashboardDocument } = await resultPromise;

    expect(result.isError).toBe(false);
    expect(applyDashboardDocument).toHaveBeenCalledTimes(1);
  });

  it('rejects sibling content loss alongside the live container-style normalization', async () => {
    vi.useFakeTimers();
    const resultPromise = callTool(
      {
        dashboardName: 'dashboard-1',
        cornerRadius: 18,
        scope: 'containers',
      },
      {
        source: LIVE_COMPOSED_DASHBOARD_XML,
        readbackXml: LIVE_ROUNDED_DASHBOARD_READBACK_XML.replace(
          'Rounded Corners — Profit by Sub-Category</run>',
          '</run>',
        ),
      },
    );
    await vi.advanceTimersByTimeAsync(READBACK_POLL_INTERVAL_MS * READBACK_POLL_MAX_ATTEMPTS);
    const { result, applyDashboardDocument } = await resultPromise;

    expect(result.isError).toBe(true);
    expect(applyDashboardDocument).toHaveBeenCalledTimes(1);
  });
});

type ToolArgs = {
  dashboardName: string;
  cornerRadius: number;
  scope: 'all' | 'containers' | 'zone_ids';
  zoneIds?: string[];
};

async function callTool(
  args: ToolArgs,
  options: {
    source?: string;
    readbackXml?: string;
    driftBeforeApply?: boolean;
    readback?: 'error' | 'unsettled';
    applyDocumentWarning?: string;
    dropNestedZoneOnReadback?: boolean;
    dropSiblingStyleOnReadback?: boolean;
    benignReserializationOnReadback?: boolean;
    executorFunctions?: {
      getDashboardDocument: ReturnType<typeof vi.fn>;
      applyDashboardDocument: ReturnType<typeof vi.fn>;
    };
  } = {},
): Promise<{
  result: CallToolResult;
  getDashboardDocument: ReturnType<typeof vi.fn>;
  applyDashboardDocument: ReturnType<typeof vi.fn>;
}> {
  let document = options.source ?? DASHBOARD_XML;
  let reads = 0;
  let applied = false;
  const getDashboardDocument =
    options.executorFunctions?.getDashboardDocument ??
    vi.fn(async () => {
      reads += 1;
      if (options.readback === 'error' && applied) {
        return new Err({ type: 'command-timed-out' as const, error: 'Readback timed out.' });
      }
      if (options.driftBeforeApply && reads === 2) {
        document = document.replace("value='#FFFFFF'", "value='#EEEEEE'");
      }
      return new Ok({ xml: document });
    });
  const applyDashboardDocument =
    options.executorFunctions?.applyDashboardDocument ??
    vi.fn(async (_id: string, xml: string) => {
      applied = true;
      if (options.readback !== 'unsettled') {
        if (options.readbackXml !== undefined) {
          document = options.readbackXml;
        } else if (options.dropNestedZoneOnReadback) {
          document = xml.replace(
            "      <zone id='3' name='Profit' type-v2='worksheet'>\n        <zone-style><format attr='border-color' value='#BBBBBB' /></zone-style>\n      </zone>\n",
            '',
          );
        } else if (options.dropSiblingStyleOnReadback) {
          document = xml.replace(
            "        <zone-style><format attr='border-color' value='#BBBBBB' /></zone-style>\n",
            '',
          );
        } else if (options.benignReserializationOnReadback) {
          document = xml
            .replaceAll("'", '"')
            .replace(
              '<zone h="5000" id="2" type-v2="layout-basic" w="6000">',
              '<zone type-v2="layout-basic" w="6000" id="2" h="5000">',
            )
            .replace(/>\s+</g, '><');
        } else {
          document = xml;
        }
      }
      return new Ok({
        command_id: 'apply-1',
        status: 'completed',
        result: null,
        warnings:
          options.applyDocumentWarning === undefined
            ? []
            : [{ code: 'document-warning', message: options.applyDocumentWarning }],
      });
    });
  const executor = {
    instanceId: 'desktop-instance',
    listDashboards: vi.fn().mockResolvedValue(
      new Ok({
        dashboards: [{ id: 'dashboard-1', name: 'Executive Overview' }],
      }),
    ),
    getDashboardDocument,
    applyDashboardDocument,
  };
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue(executor),
  };
  const tool = getFormatDashboardZonesTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const result = await callback({ session: '12345', ...args, zoneIds: args.zoneIds }, extra);
  return { result, getDashboardDocument, applyDashboardDocument };
}
