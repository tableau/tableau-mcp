import { Err, Ok } from 'ts-results-es';

import { makeExecutorMock } from '../externalApi/executor.mock.js';
import { loadDashboardXml, loadStoryboardXml } from './loadDashboardXml.js';

const focus = { navigate: 'none', reason: 'intermediate-leg' } as const;
const signal = new AbortController().signal;
const DS = 'federated.csv040059ff380b040059ff380b';
const SHEETS = ['Total Revenue', 'Revenue by Product per Period'];
const UUID = '{11111111-2222-3333-4444-555555555555}';

// The live API shape: XML header, double-quoted attributes, top-level <datasources>.
function snapshot(datasources = ''): string {
  return `<?xml version="1.0" encoding="utf-8" ?>
<workbook original-version="18.1" version="18.1" xmlns:user="http://www.tableausoftware.com/xml/user">
  <datasources>
    <datasource caption="gross-margin-calc" inline="true" name="${DS}" version="18.1">
      <connection class="federated" />
    </datasource>
    <datasource name="Parameters">
      <column caption="Pick" datatype="integer" name="[Parameter 1]" role="measure" type="quantitative" value="1" />
    </datasource>${datasources}
  </datasources>
  <worksheets>${SHEETS.map((name) => `<worksheet name="${name}"><table><rows /><cols /></table></worksheet>`).join('')}</worksheets>
  <dashboards><dashboard name="DS Dash"><zones /><simple-id uuid="${UUID}" /></dashboard></dashboards>
  <windows><window class="dashboard" name="DS Dash"><viewpoints>${SHEETS.map((name) => `<viewpoint name="${name}" />`).join('')}</viewpoints></window></windows>
</workbook>`;
}

// base-1 seq 15's fragment, single-quoted as the agent sent it; `block` replaces its <datasources>.
function fragment(block: string | null, zones = 'worksheets'): string {
  const worksheetZones =
    zones === 'worksheets'
      ? `<zone h='100000' id='5' name='Total Revenue' w='30000' x='0' y='0' />
        <zone h='100000' id='6' name='Revenue by Product per Period' w='50000' x='30000' y='0' />`
      : '';
  return `<dashboard enable-sort-zone-taborder='true' name='DS Dash' xmlns:user='http://www.tableausoftware.com/xml/user'>
  <style />
  <size maxheight='800' maxwidth='1000' minheight='800' minwidth='1000' />
  <zones>
    <zone h='100000' id='4' type-v2='layout-basic' w='100000' x='0' y='0'>
      <zone h='100000' id='3' param='horz' type-v2='layout-flow' w='100000' x='0' y='0'>
        ${worksheetZones}
        <zone h='100000' id='7' name='Revenue by Product per Period' param='[${DS}].[none:product_line:nk]' type-v2='filter' values='database' w='20000' x='80000' y='0' />
      </zone>
    </zone>
  </zones>
${block === null ? '' : `  <datasources>\n    ${block}\n  </datasources>\n`}  <datasource-dependencies datasource='${DS}'>
    <column datatype='string' name='[product_line]' role='dimension' type='nominal' />
    <column-instance column='[product_line]' derivation='None' name='[none:product_line:nk]' pivot='key' type='nominal' />
  </datasource-dependencies>
  <simple-id uuid='${UUID}' />
</dashboard>
`;
}

function setup(workbookXml = snapshot()): ReturnType<typeof makeExecutorMock> {
  return makeExecutorMock({
    listDashboards: vi.fn().mockResolvedValue(Ok({ dashboards: [{ id: UUID, name: 'DS Dash' }] })),
    getDashboardDocument: vi.fn().mockResolvedValue(Ok({ xml: fragment(null) })),
    getWorkbookDocument: vi.fn().mockResolvedValue(Ok({ xml: workbookXml })),
    applyDashboardDocument: vi
      .fn()
      .mockResolvedValue(Ok({ command_id: 'apply', status: 'completed', submitted_at: '' })),
  });
}

const asStoryboard = (xml: string): string =>
  xml.replace('<dashboard ', "<dashboard type='storyboard' ");

function mockStoryboard(executor: ReturnType<typeof setup>): void {
  vi.mocked(executor.listStoryboards).mockResolvedValue(
    Ok({ storyboards: [{ id: UUID, name: 'DS Dash', hidden: false }] }),
  );
  vi.mocked(executor.getStoryboardDocument).mockResolvedValue(
    Ok({ xml: fragment(null), applicationVersion: undefined, xsdPayloadVersion: undefined }),
  );
  vi.mocked(executor.applyStoryboardDocument).mockResolvedValue(
    Ok({ command_id: 'apply', status: 'completed', submitted_at: '' }),
  );
}

const apply = (
  executor: ReturnType<typeof setup>,
  xml: string,
): ReturnType<typeof loadDashboardXml> =>
  loadDashboardXml({
    dashboardName: 'DS Dash',
    xml,
    focus,
    executor,
    signal,
    requireExistingSheet: true,
    verifyReadback: false,
  });

async function refusalOf(executor: ReturnType<typeof setup>, xml: string): Promise<string> {
  const result = await apply(executor, xml);
  expect(result.isErr()).toBe(true);
  const error = result.unwrapErr();
  expect(error).toMatchObject({
    type: 'load-dashboard-xml-error',
    error: { type: 'datasource-mismatch' },
  });
  expect(executor.applyDashboardDocument).not.toHaveBeenCalled();
  expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
  return (error as { error: { message: string } }).error.message;
}

describe('dashboard <datasources> entry must match the workbook', () => {
  it('refuses a captionless entry and names the workbook caption and the exact FIX element', async () => {
    const executor = setup();
    const message = await refusalOf(executor, fragment(`<datasource name='${DS}' />`));
    expect(message).toBe(
      `The dashboard's <datasources> entry for "${DS}" has no caption, but the workbook's caption is "gross-margin-calc". ` +
        'Desktop opens a "Where is the data source" dialog for an entry that doesn\'t match. ' +
        `FIX: use <datasource caption='gross-margin-calc' name='${DS}' />, the workbook's own entry, ` +
        'or leave the <datasources> block out and Tableau adds it. No changes were sent to Tableau.',
    );
  });

  it('refuses a wrong caption and says the caption it sent', async () => {
    const message = await refusalOf(
      setup(),
      fragment(`<datasource caption='Data' name='${DS}' />`),
    );
    expect(message).toContain(
      'has caption "Data", but the workbook\'s caption is "gross-margin-calc"',
    );
    expect(message).toContain(`<datasource caption='gross-margin-calc' name='${DS}' />`);
  });

  it('refuses an unknown name and lists the workbook entries', async () => {
    const message = await refusalOf(
      setup(),
      fragment("<datasource caption='gross-margin-calc' name='federated.other' />"),
    );
    expect(message).toContain('"federated.other" is not a datasource in this workbook');
    expect(message).toContain(`<datasource caption='gross-margin-calc' name='${DS}' />`);
    expect(message).toContain("<datasource name='Parameters' />");
  });

  it('proceeds on an exact match with the same calls as a fragment without the block', async () => {
    const withBlock = setup();
    const without = setup();
    const matched = await apply(
      withBlock,
      fragment(`<datasource caption='gross-margin-calc' name='${DS}' />`),
    );
    const bare = await apply(without, fragment(null));
    expect(matched.isOk()).toBe(true);
    expect(bare.isOk()).toBe(true);
    expect(withBlock.applyDashboardDocument).toHaveBeenCalledTimes(1);
    expect(withBlock.getWorkbookDocument).toHaveBeenCalledTimes(
      vi.mocked(without.getWorkbookDocument).mock.calls.length,
    );
  });

  it('does not read the snapshot for a filter-only fragment without a block', async () => {
    const executor = setup();
    const result = await apply(executor, fragment(null, 'filter-only'));
    expect(result.isOk()).toBe(true);
    expect(executor.getWorkbookDocument).not.toHaveBeenCalled();
  });

  it('accepts a captionless Parameters entry that matches a captionless workbook entry', async () => {
    const executor = setup();
    const result = await apply(executor, fragment("<datasource name='Parameters' />"));
    expect(result.isOk()).toBe(true);
    expect(executor.applyDashboardDocument).toHaveBeenCalledTimes(1);
  });

  it("refuses caption='Parameters' against a captionless workbook Parameters", async () => {
    const message = await refusalOf(
      setup(),
      fragment("<datasource caption='Parameters' name='Parameters' />"),
    );
    expect(message).toContain('has caption "Parameters", but the workbook\'s entry has no caption');
    expect(message).toContain("FIX: use <datasource name='Parameters' />,");
  });

  it('names only the bad datasource when two are sent', async () => {
    const message = await refusalOf(
      setup(),
      fragment(
        `<datasource caption='gross-margin-calc' name='${DS}' />\n    <datasource caption='Wrong' name='Parameters' />`,
      ),
    );
    expect(message).toContain('entry for "Parameters"');
    expect(message).not.toContain(`entry for "${DS}"`);
  });

  it('compares decoded captions and escapes the FIX element so it re-parses', async () => {
    const caption = 'Tom & Jerry\'s "Q<3>"';
    const workbook = snapshot('').replace(
      'caption="gross-margin-calc"',
      'caption="Tom &amp; Jerry&apos;s &quot;Q&lt;3&gt;&quot;"',
    );
    const ok = setup(workbook);
    const matched = await apply(
      ok,
      fragment(
        `<datasource caption='Tom &amp; Jerry&apos;s &quot;Q&lt;3&gt;&quot;' name='${DS}' />`,
      ),
    );
    expect(matched.isOk()).toBe(true);

    const message = await refusalOf(setup(workbook), fragment(`<datasource name='${DS}' />`));
    expect(message).toContain(`has no caption, but the workbook's caption is "${caption}"`);
    const fix = /FIX: use (<datasource .*? \/>), the workbook's own entry/.exec(message)![1];
    expect(fix).toBe(
      `<datasource caption='Tom &amp; Jerry&apos;s &quot;Q&lt;3&gt;&quot;' name='${DS}' />`,
    );
    const { DOMParser } = await import('@xmldom/xmldom');
    const parsed = new DOMParser().parseFromString(fix, 'text/xml').documentElement!;
    expect(parsed.getAttribute('caption')).toBe(caption);
  });

  it('reads the snapshot for a filter-only fragment that carries a block, and refuses a mismatch', async () => {
    const executor = setup();
    const message = await refusalOf(
      executor,
      fragment(`<datasource name='${DS}' />`, 'filter-only'),
    );
    expect(message).toContain('has no caption');
    expect(executor.getWorkbookDocument).toHaveBeenCalledTimes(1);
  });

  it('proceeds for a matching filter-only fragment', async () => {
    const executor = setup();
    const result = await apply(
      executor,
      fragment(`<datasource caption='gross-margin-calc' name='${DS}' />`, 'filter-only'),
    );
    expect(result.isOk()).toBe(true);
    expect(executor.getWorkbookDocument).toHaveBeenCalledTimes(1);
  });

  it('fails closed with zero writes when the snapshot read fails for a filter-only fragment', async () => {
    const executor = setup();
    const failure = { type: 'http-error', status: 500, message: 'boom' } as const;
    vi.mocked(executor.getWorkbookDocument).mockResolvedValue(Err(failure as never));
    const result = await apply(
      executor,
      fragment(`<datasource caption='gross-margin-calc' name='${DS}' />`, 'filter-only'),
    );
    expect(result.unwrapErr()).toEqual({ type: 'execute-command-error', error: failure });
    expect(executor.applyDashboardDocument).not.toHaveBeenCalled();
    expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('passes a matching block through the storyboard path unchanged', async () => {
    const executor = setup();
    mockStoryboard(executor);
    const result = await loadStoryboardXml({
      storyboardName: 'DS Dash',
      xml: asStoryboard(fragment(`<datasource caption='gross-margin-calc' name='${DS}' />`)),
      focus,
      executor,
      signal,
      requireExistingSheet: true,
    });
    expect(result.isOk()).toBe(true);
    expect(executor.applyStoryboardDocument).toHaveBeenCalledTimes(1);
    expect(executor.applyDashboardDocument).not.toHaveBeenCalled();
  });

  it('refuses a mismatched block through the storyboard path with zero writes', async () => {
    const executor = setup();
    mockStoryboard(executor);
    const result = await loadStoryboardXml({
      storyboardName: 'DS Dash',
      xml: asStoryboard(fragment(`<datasource name='${DS}' />`)),
      focus,
      executor,
      signal,
      requireExistingSheet: true,
    });
    expect(result.unwrapErr()).toMatchObject({
      error: { type: 'datasource-mismatch', message: expect.stringContaining('FIX: use') },
    });
    expect(executor.applyDashboardDocument).not.toHaveBeenCalled();
    expect(executor.applyStoryboardDocument).not.toHaveBeenCalled();
  });

  it('returns source drift, not the datasource refusal, for a stale cache with a mismatched caption', async () => {
    const executor = setup();
    const result = await loadDashboardXml({
      dashboardName: 'DS Dash',
      xml: fragment(`<datasource name='${DS}' />`),
      focus,
      executor,
      signal,
      requireExistingSheet: true,
      verifyReadback: false,
      expectedSourceHash: 'not-the-live-hash',
    });
    expect(result.unwrapErr()).toMatchObject({ error: { type: 'source-drift' } });
    expect(executor.applyDashboardDocument).not.toHaveBeenCalled();
    expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
  });
});
