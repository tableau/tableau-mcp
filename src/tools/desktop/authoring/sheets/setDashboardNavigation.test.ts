import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import {
  getSetDashboardNavigationTool,
  setDashboardNavigationDocument,
} from './setDashboardNavigation.js';

const dashboardXml = (name: string): string => `<dashboard name='${name}'>
  <size maxheight='1000' maxwidth='1400' minheight='1000' minwidth='1400' sizing-mode='fixed'/>
  <zones>
    <zone h='100000' id='9' type-v2='layout-basic' w='100000' x='0' y='0'>
      <zone h='8000' id='10' type-v2='text' w='100000' x='0' y='0'><formatted-text><run>${name}</run></formatted-text></zone>
      <zone h='92000' id='11' name='Chart' w='100000' x='0' y='8000'/>
    </zone>
  </zones>
  <simple-id uuid='{dashboard-${name}}'/>
</dashboard>`;

const TARGETS = [
  { name: 'Sales Overview', label: 'Sales', windowUuid: '{window-sales}' },
  { name: 'Regional Performance', label: 'Regions', windowUuid: '{window-regions}' },
  { name: 'Product Deep-Dive', label: 'Products', windowUuid: '{window-products}' },
];

describe('setDashboardNavigationDocument', () => {
  it('reserves the existing title band and adds native links as root zone siblings', () => {
    const result = setDashboardNavigationDocument(
      dashboardXml('Sales Overview'),
      'Sales Overview',
      TARGETS,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.xml).toContain("type-v2='text' w='70000'");
    expect(result.xml).toContain('caption>Regions</caption>');
    expect(result.xml).toContain('caption>Products</caption>');
    expect(result.xml).toContain('window-id=&quot;{window-regions}&quot;');
    expect(result.xml).toContain('window-id=&quot;{window-products}&quot;');
    expect(result.xml).not.toContain('{dashboard-Regional Performance}');
    expect(result.xml).not.toContain('background-color');
    expect(result.xml).not.toContain('fontname');

    expect(result.xml.match(/type-v2='dashboard-object'/g)).toHaveLength(2);
    expect(result.xml).toMatch(/<\/zone>\s*<zone h='8000' id='12' type-v2='dashboard-object'/);
  });

  it('accepts compose-dashboard zones that contain zone-style children', () => {
    const source = `<dashboard enable-sort-zone-taborder='true' name='Sales Overview'>
  <size maxheight='1000' maxwidth='1400' minheight='1000' minwidth='1400' sizing-mode='fixed' />
  <zones>
    <zone h='100000' id='9' type-v2='layout-basic' w='100000' x='0' y='0'>
      <zone h='8000' id='10' type-v2='text' w='100000' x='0' y='0'>
        <formatted-text><run>Sales Overview</run></formatted-text>
        <zone-style><format attr='margin' value='4' /></zone-style>
      </zone>
      <zone h='92000' id='11' name='Chart' w='100000' x='0' y='8000'>
        <zone-style><format attr='margin' value='4' /></zone-style>
      </zone>
    </zone>
  </zones>
</dashboard>`;

    const result = setDashboardNavigationDocument(source, 'Sales Overview', TARGETS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.xml).toContain('<zone-style>');
    expect(result.xml.match(/type-v2='dashboard-object'/g)).toHaveLength(2);
  });

  it('ignores id suffix attributes when allocating navigation zone IDs', () => {
    const source = dashboardXml('Sales Overview').replace(
      '  <simple-id',
      "  <devicelayouts><devicelayout name='Phone'><zones><zone id='99' pane-specification-id='0'/></zones></devicelayout></devicelayouts>\n  <simple-id",
    );

    const result = setDashboardNavigationDocument(source, 'Sales Overview', TARGETS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.xml).toContain("<zone id='99' pane-specification-id='0'/>");
    expect(result.xml).toContain("id='100' type-v2='dashboard-object'");
    expect(result.xml).toContain("id='101' type-v2='dashboard-object'");
  });

  it('accepts exact requested navigation idempotently without changing it', () => {
    const first = setDashboardNavigationDocument(
      dashboardXml('Sales Overview'),
      'Sales Overview',
      TARGETS,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = setDashboardNavigationDocument(first.xml, 'Sales Overview', TARGETS);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.xml.match(/tabdoc:goto-sheet/g)).toHaveLength(2);
    expect(second.xml).toBe(first.xml);
  });

  it('fails closed when exact navigation overlaps an additional preserved root zone', () => {
    const first = setDashboardNavigationDocument(
      dashboardXml('Sales Overview'),
      'Sales Overview',
      TARGETS,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const source = first.xml.replace(
      '</zones>',
      "<zone h='8000' id='14' name='User control' w='30000' x='70000' y='0'/></zones>",
    );

    const result = setDashboardNavigationDocument(source, 'Sales Overview', TARGETS);

    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.message).toContain('overlap');
  });

  it('fails closed when a nested preserved zone overlaps the proposed navigation band', () => {
    const source = dashboardXml('Sales Overview').replace(
      "      <zone h='92000'",
      "      <zone h='8000' id='12' name='User control' w='30000' x='70000' y='0'/>\n      <zone h='92000'",
    );

    const result = setDashboardNavigationDocument(source, 'Sales Overview', TARGETS);

    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.message).toContain('overlap');
  });

  it('fails closed when a nested preserved zone has unknown geometry', () => {
    const source = dashboardXml('Sales Overview').replace(
      "      <zone h='92000'",
      "      <zone h='8000' id='12' name='User control' w='30000' y='0'/>\n      <zone h='92000'",
    );

    const result = setDashboardNavigationDocument(source, 'Sales Overview', TARGETS);

    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.message).toContain('geometry');
  });

  it('fails closed when a different root top-row goto-sheet object already exists', () => {
    const existing =
      "<zone h='8000' id='12' type-v2='dashboard-object' w='15000' x='85000' y='0'><button button-type='text' action='tabdoc:goto-sheet window-id=&quot;{window-other}&quot;'><button-visual-state><caption>Other</caption></button-visual-state></button></zone>";
    const source = dashboardXml('Sales Overview').replace('</zones>', `${existing}</zones>`);

    const result = setDashboardNavigationDocument(source, 'Sales Overview', TARGETS);

    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.message).toContain('existing navigation');
  });

  it('fails closed when a different nested goto-sheet object already exists', () => {
    const existing =
      "<zone h='8000' id='12' type-v2='dashboard-object' w='15000' x='85000' y='0'><button button-type='text' action='tabdoc:goto-sheet window-id=&quot;{window-other}&quot;'><button-visual-state><caption>Other</caption></button-visual-state></button></zone>";
    const source = dashboardXml('Sales Overview').replace(
      "      <zone h='92000'",
      `      ${existing}\n      <zone h='92000'`,
    );

    const result = setDashboardNavigationDocument(source, 'Sales Overview', TARGETS);

    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.message).toContain('existing navigation');
  });

  it('fails closed when exact requested navigation is nested under layout-basic', () => {
    const targets = TARGETS.slice(0, 2);
    const first = setDashboardNavigationDocument(
      dashboardXml('Sales Overview'),
      'Sales Overview',
      targets,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const source = nestRootNavigationUnderLayout(first.xml);

    const result = setDashboardNavigationDocument(source, 'Sales Overview', targets);

    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.message).toContain('existing navigation');
  });

  it('fails closed when generated buttons would overlap a preserved root top-row zone', () => {
    const source = dashboardXml('Sales Overview').replace(
      '</zones>',
      "<zone h='8000' id='12' name='User control' w='45000' x='55000' y='0'/></zones>",
    );
    const result = setDashboardNavigationDocument(source, 'Sales Overview', [
      ...TARGETS,
      { name: 'Customer Detail', label: 'Customers', windowUuid: '{window-customers}' },
    ]);

    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.message).toContain('overlap');
  });

  it('preserves non-zone content in the root zones container', () => {
    const source = dashboardXml('Sales Overview').replace(
      "<zone h='100000'",
      "<!-- preserved -->\n    <zone h='100000'",
    );
    const result = setDashboardNavigationDocument(source, 'Sales Overview', TARGETS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.xml).toContain('<!-- preserved -->');
  });

  it('fails closed when the dashboard has no safe top title band', () => {
    const result = setDashboardNavigationDocument(
      dashboardXml('Sales Overview').replace("type-v2='text'", "type-v2='worksheet'"),
      'Sales Overview',
      TARGETS,
    );

    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.message).toContain('top title band');
  });
});

describe('set-dashboard-navigation tool', () => {
  it('uses a bounded ordered dashboard suite', () => {
    const tool = getSetDashboardNavigationTool(new DesktopMcpServer());
    expect(tool.name).toBe('set-dashboard-navigation');
    expect(Object.keys(tool.paramsSchema)).toEqual(['session', 'dashboards']);
    expect(tool.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    });
  });

  it('preflights every dashboard, applies scoped documents, and verifies each readback', async () => {
    const { result, applyDashboardDocument } = await callTool();

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      dashboards: [
        {
          dashboard: 'Sales Overview',
          links: ['Regional Performance'],
          applied: true,
          verified: true,
        },
        {
          dashboard: 'Regional Performance',
          links: ['Sales Overview'],
          applied: true,
          verified: true,
        },
      ],
    });
    expect(applyDashboardDocument).toHaveBeenCalledTimes(2);
  });

  it('fails before any apply when a dashboard window UUID cannot be resolved', async () => {
    const { result, applyDashboardDocument } = await callTool({ omitSecondWindow: true });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('window UUID');
    expect(applyDashboardDocument).not.toHaveBeenCalled();
  });

  it('rejects readback that nests the goto button under layout-basic', async () => {
    const { result } = await callTool({
      sourceXmlTransform: (xml) =>
        xml.replace(
          "<zone h='100000' id='9' type-v2='layout-basic' w='100000' x='0' y='0'>",
          "<zone h='8000' id='9' type-v2='layout-basic' w='15000' x='85000' y='0'>",
        ),
      readbackTransform: nestRootNavigationUnderLayout,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('did not survive readback');
  });

  it('rejects readback when a decoy text zone hides the wrong title width', async () => {
    const { result } = await callTool({
      sourceXmlTransform: (xml) =>
        xml.replace(
          "      <zone h='8000'",
          "      <zone h='1000' id='99' type-v2='text' w='12345' x='5000' y='16000'/>\n      <zone h='8000'",
        ),
      readbackTransform: (xml) =>
        xml.replace(
          "type-v2='text' w='85000' x='0' y='0'",
          "type-v2='text' w='100000' x='0' y='0'",
        ),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('did not survive readback');
  });

  it('rejects readback that introduces an overlapping nested preserved zone', async () => {
    const { result } = await callTool({
      readbackTransform: (xml) =>
        xml.replace(
          "      <zone h='92000'",
          "      <zone h='8000' id='99' name='Injected control' w='15000' x='85000' y='0'/>\n      <zone h='92000'",
        ),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('did not survive readback');
  });

  it('rejects readback that drops a chart zone below the title band', async () => {
    const { result } = await callTool({
      readbackTransform: (xml) => xml.replace(/<zone h='92000'[^>]*\/>/, ''),
    });

    const text = errorText(result);
    expect(text).toContain('verified: false');
    expect(text).toContain("name='Chart'");
  });

  it('rejects readback that mutates a chart zone attribute', async () => {
    const { result } = await callTool({
      readbackTransform: (xml) => xml.replace("name='Chart'", "name='Other chart'"),
    });

    const text = errorText(result);
    expect(text).toContain('verified: false');
    expect(text).toContain("name='Chart'");
  });

  it('rejects readback that resizes a chart zone by more than the rounding tolerance', async () => {
    const { result } = await callTool({
      readbackTransform: (xml) => xml.replace("h='92000'", "h='91000'"),
    });

    expect(errorText(result)).toContain('verified: false');
  });

  it('rejects readback that drops a nested child of a preserved zone', async () => {
    const { result } = await callTool({
      sourceXmlTransform: withNestedContainer,
      readbackTransform: (xml) => xml.replace(/<zone h='40000' id='13'[^>]*\/>/, ''),
    });

    const text = errorText(result);
    expect(text).toContain('verified: false');
    expect(text).toContain("id='13'");
  });

  it('rejects readback that reorders preserved zones', async () => {
    const { result } = await callTool({
      sourceXmlTransform: withTwoCharts,
      readbackTransform: (xml) => {
        const first = /<zone h='46000' id='11'[^>]*\/>/.exec(xml)![0];
        const second = /<zone h='46000' id='12'[^>]*\/>/.exec(xml)![0];
        return xml.replace(first, '@@A@@').replace(second, first).replace('@@A@@', second);
      },
    });

    expect(errorText(result)).toContain('verified: false');
  });

  it('accepts readback where Desktop rounds zone coordinates by 1 and adds an id', async () => {
    const { result } = await callTool({
      readbackTransform: (xml) =>
        xml
          .replace("h='92000'", "h='92001'")
          .replace("y='8000'", "y='7999'")
          .replace("name='Chart'", "name='Chart' simple-id='{added}'"),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).dashboards[0]).toMatchObject({
      applied: true,
      verified: true,
    });
  });

  it('stops without a second apply when the dashboard changed after preflight', async () => {
    const { result, applyDashboardDocument } = await callTool({ driftFor: 'dashboard-1' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('changed while navigation was being applied');
    expect(applyDashboardDocument).not.toHaveBeenCalled();
  });

  it('names the dashboards already applied when a later drift stops the loop', async () => {
    const { result, applyDashboardDocument } = await callTool({ driftFor: 'dashboard-2' });

    expect(applyDashboardDocument).toHaveBeenCalledTimes(1);
    expect(errorText(result)).toContain('Already applied and not rolled back: "Sales Overview"');
  });

  it('reports an apply failure on the first dashboard without claiming earlier work', async () => {
    const { result, applyDashboardDocument } = await callTool({ applyErrorFor: 'dashboard-1' });

    expect(applyDashboardDocument).toHaveBeenCalledTimes(1);
    expect(errorText(result)).toContain('No earlier dashboard was changed');
  });

  it('names the dashboards already applied when a later apply fails', async () => {
    const { result } = await callTool({ applyErrorFor: 'dashboard-2' });

    expect(errorText(result)).toContain('Already applied and not rolled back: "Sales Overview"');
  });

  it('names the dashboards already applied when a later readback fails', async () => {
    const { result } = await callTool({ readbackErrorFor: 'dashboard-2' });

    const text = errorText(result);
    expect(text).toContain('Already applied and not rolled back: "Sales Overview"');
    expect(text).toContain('"Regional Performance" itself was changed in Desktop');
  });

  it('rejects at preflight, before any apply, when a dashboard has no top title band', async () => {
    const { result, applyDashboardDocument } = await callTool({
      sourceXmlTransform: (xml) => xml.replace(/<zone h='8000' id='10'[\s\S]*?<\/zone>/, ''),
    });

    const text = errorText(result);
    expect(text).toContain('title band');
    expect(applyDashboardDocument).not.toHaveBeenCalled();
  });

  it('reports a dashboard that already matches as skipped, not verified', async () => {
    const { result, applyDashboardDocument } = await callTool({ preNavigated: true });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const { dashboards } = JSON.parse(result.content[0].text);
    expect(dashboards).toHaveLength(2);
    for (const entry of dashboards) {
      expect(entry).toMatchObject({ applied: false, verified: false });
      expect(entry.note).toContain('nothing was applied');
    }
    expect(applyDashboardDocument).not.toHaveBeenCalled();
  });
});

type CallToolOptions = {
  omitSecondWindow?: boolean;
  sourceXmlTransform?: (xml: string) => string;
  readbackTransform?: (xml: string) => string;
  driftFor?: string;
  applyErrorFor?: string;
  readbackErrorFor?: string;
  preNavigated?: boolean;
};

async function callTool(options: CallToolOptions = {}): Promise<{
  result: CallToolResult;
  applyDashboardDocument: ReturnType<typeof vi.fn>;
}> {
  const dashboards = [
    { id: 'dashboard-1', name: 'Sales Overview' },
    { id: 'dashboard-2', name: 'Regional Performance' },
  ];
  const documents = new Map(
    dashboards.map(({ id, name }) => {
      const xml = dashboardXml(name);
      const base = options.sourceXmlTransform?.(xml) ?? xml;
      if (!options.preNavigated) return [id, base];
      const navigated = setDashboardNavigationDocument(
        base,
        name,
        dashboards.map((d) => ({
          name: d.name,
          label: d.name === 'Sales Overview' ? 'Sales' : 'Regions',
          windowUuid: `{window-${d.id}}`,
        })),
      );
      invariant(navigated.ok);
      return [id, navigated.xml];
    }),
  );
  const applied = new Set<string>();
  const reads = new Map<string, number>();
  const applyDashboardDocument = vi.fn(async (id: string, xml: string) => {
    if (id === options.applyErrorFor) {
      return new Err({ type: 'invalid-response' as const, error: 'apply boom' });
    }
    applied.add(id);
    documents.set(id, (options.readbackTransform?.(xml) ?? xml).replaceAll('/>', ' />'));
    return new Ok({ command_id: 'apply-dashboard', status: 'completed', result: null });
  });
  const windows = dashboards
    .filter(({ id }) => !(options.omitSecondWindow && id === 'dashboard-2'))
    .map(
      ({ id, name }) =>
        `<window class='dashboard' name='${name}'><simple-id uuid='{window-${id}}'/></window>`,
    )
    .join('');
  const executor = {
    instanceId: 'desktop-instance',
    listDashboards: vi.fn().mockResolvedValue(new Ok({ dashboards })),
    getDashboardDocument: vi.fn(async (id: string) => {
      const count = (reads.get(id) ?? 0) + 1;
      reads.set(id, count);
      // Read 1 is preflight, read 2 is the in-lock recheck.
      if (id === options.driftFor && count === 2) {
        return new Ok({ xml: `${documents.get(id)!}<!-- edited by a user -->` });
      }
      if (id === options.readbackErrorFor && applied.has(id)) {
        return new Err({ type: 'invalid-response' as const, error: 'readback boom' });
      }
      return new Ok({ xml: documents.get(id)! });
    }),
    applyDashboardDocument,
    getWorkbookDocument: vi
      .fn()
      .mockResolvedValue(new Ok({ xml: `<workbook><windows>${windows}</windows></workbook>` })),
  };
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue(executor),
  };
  const callback = await Provider.from(
    getSetDashboardNavigationTool(new DesktopMcpServer()).callback,
  );
  const result = await callback(
    {
      session: '12345',
      dashboards: [
        { dashboard: 'Sales Overview', label: 'Sales' },
        { dashboard: 'Regional Performance', label: 'Regions' },
      ],
    },
    extra,
  );
  return { result, applyDashboardDocument };
}

function nestRootNavigationUnderLayout(xml: string): string {
  const button = /<zone\b[^>]*type-v2='dashboard-object'[\s\S]*?<\/zone>/.exec(xml)?.[0];
  if (!button) return xml;
  return xml.replace(button, '').replace(/<\/zone>(\s*)<\/zones>/, `${button}</zone>$1</zones>`);
}

function errorText(result: CallToolResult): string {
  expect(result.isError).toBe(true);
  invariant(result.content[0].type === 'text');
  return result.content[0].text;
}

function withNestedContainer(xml: string): string {
  return xml.replace(
    "<zone h='92000' id='11' name='Chart' w='100000' x='0' y='8000'/>",
    "<zone h='92000' id='11' type-v2='layout-flow' w='100000' x='0' y='8000'><zone h='40000' id='13' name='Inner A' w='100000' x='0' y='8000'/><zone h='52000' id='14' name='Inner B' w='100000' x='0' y='48000'/></zone>",
  );
}

function withTwoCharts(xml: string): string {
  return xml.replace(
    "<zone h='92000' id='11' name='Chart' w='100000' x='0' y='8000'/>",
    "<zone h='46000' id='11' name='Chart A' w='100000' x='0' y='8000'/><zone h='46000' id='12' name='Chart B' w='100000' x='0' y='54000'/>",
  );
}
