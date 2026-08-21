import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

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

  it('fails closed when a different root top-row goto-sheet object already exists', () => {
    const existing =
      "<zone h='8000' id='12' type-v2='dashboard-object' w='15000' x='85000' y='0'><button button-type='text' action='tabdoc:goto-sheet window-id=&quot;{window-other}&quot;'><button-visual-state><caption>Other</caption></button-visual-state></button></zone>";
    const source = dashboardXml('Sales Overview').replace('</zones>', `${existing}</zones>`);

    const result = setDashboardNavigationDocument(source, 'Sales Overview', TARGETS);

    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.message).toContain('existing navigation');
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
        { dashboard: 'Sales Overview', links: ['Regional Performance'], verified: true },
        { dashboard: 'Regional Performance', links: ['Sales Overview'], verified: true },
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
          "      <zone h='1000' id='99' type-v2='text' w='12345' x='5000' y='5000'/>\n      <zone h='8000'",
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
});

type CallToolOptions = {
  omitSecondWindow?: boolean;
  sourceXmlTransform?: (xml: string) => string;
  readbackTransform?: (xml: string) => string;
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
      return [id, options.sourceXmlTransform?.(xml) ?? xml];
    }),
  );
  const applyDashboardDocument = vi.fn(async (id: string, xml: string) => {
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
    getDashboardDocument: vi.fn(async (id: string) => new Ok({ xml: documents.get(id)! })),
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
