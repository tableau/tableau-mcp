import { Err, Ok } from 'ts-results-es';

import { Config } from '../../../../config.desktop.js';
import type { ExternalApiToolExecutor } from '../../../../desktop/externalApi/externalApiToolExecutor.js';
import { extractSheetXml, listWorksheetRefs } from '../../../../desktop/metadata/sheets.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getBindTemplateTool } from './bindTemplate.js';

const OTHER_SHEET = `<worksheet name='Untouched'>
      <table>
        <view>
          <datasources />
          <aggregation value='true' />
        </view>
        <style />
        <panes><pane><view><breakdown value='auto' /></view><mark class='Automatic' /></pane></panes>
        <rows />
        <cols />
      </table>
      <simple-id uuid='{00000000-0000-0000-0000-0000000000AA}' />
    </worksheet>`;

const WORKBOOK_XML = `<?xml version='1.0' encoding='utf-8'?>
<workbook>
  <datasources>
    <datasource name='Superstore'>
      <column caption='Region' name='[Region]' role='dimension' type='nominal' datatype='string' />
      <column caption='Sales' name='[Sales]' role='measure' type='quantitative' datatype='real' />
    </datasource>
  </datasources>
  <worksheets>
    ${OTHER_SHEET}
  </worksheets>
  <windows>
    <window class='worksheet' name='Untouched' />
  </windows>
</workbook>`;

describe('bind-template offered sorted-bar replacement on the full template catalog', () => {
  beforeEach(() => {
    vi.stubEnv('TABLEAU_DESKTOP_SESSION_ID', '7');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const makeHarness = (
    workbook: string,
    datasources: string[],
    measureNames: string[],
  ): { call: (args: Record<string, unknown>) => Promise<any>; live: () => string } => {
    let liveXml = workbook;
    const executor = {
      desktopInstanceId: 'inst-test',
      desktopApiVersion: '0.2.16',
      applyWorkbookDocument: vi.fn(async (xml: string) => {
        liveXml = xml;
        return Ok({ command_id: 'apply', status: 'completed', submitted_at: '', result: {} });
      }),
      getWorkbookDocument: vi.fn(async () =>
        Ok({ xml: liveXml, applicationVersion: undefined, xsdPayloadVersion: undefined }),
      ),
      listWorksheets: vi.fn(async () =>
        Ok({
          worksheets: listWorksheetRefs(liveXml).map(({ id, name }) => ({
            id,
            name,
            datasources,
          })),
        }),
      ),
      getWorksheetDiagnostics: vi.fn(async (worksheetId: string) =>
        Ok({ worksheets: [{ worksheetId, status: 'complete', invalidFields: [] }] }),
      ),
      getWorksheetDocument: vi.fn(async () =>
        Err({
          type: 'command-failed' as const,
          error: { code: 'not-found', message: 'No route matches /worksheets' },
        }),
      ),
      getWorksheetSummaryData: vi.fn(async (_id: string, options: { maxRows: number }) =>
        Ok({
          columns: [
            { name: 'Region', dataType: 'string' },
            { name: measureNames[0], dataType: 'real' },
          ],
          rows: Array.from({ length: 13 }, (_, i) => [`Region ${i}`, i * 10]).slice(
            0,
            options.maxRows,
          ),
        }),
      ),
    };
    const extra = {
      ...getMockRequestHandlerExtra(),
      config: new Config(),
      getExecutor: vi.fn(async () => executor as unknown as ExternalApiToolExecutor),
    };
    const call = async (args: Record<string, unknown>): Promise<any> => {
      const callback = await Provider.from(getBindTemplateTool(new DesktopMcpServer()).callback);
      const result = await callback({ session: '7', auto_apply: true, ...args } as any, extra);
      invariant(result.content[0].type === 'text');
      return JSON.parse(result.content[0].text);
    };
    return { call, live: () => liveXml };
  };

  const ds = (name: string, columns: string): string =>
    `<datasource name='${name}'>${columns}</datasource>`;
  const dim =
    "<column caption='Region' name='[Region]' role='dimension' type='nominal' datatype='string' />";
  const meas = (name: string, caption?: string): string =>
    `<column ${caption ? `caption='${caption}' ` : ''}name='[${name}]' role='measure' type='quantitative' datatype='real' />`;
  const wb = (...sources: string[]): string =>
    WORKBOOK_XML.replace(
      /<datasources>[\s\S]*<\/datasources>/,
      `<datasources>${sources.join('')}</datasources>`,
    );

  it('a Call-2 pie still gets the concrete offer, and following it rebuilds the same fields', async () => {
    const h = makeHarness(
      wb(ds('Superstore', `${dim}${meas('Sales')}`)),
      ['Superstore'],
      ['Sales'],
    );
    const body = await h.call({
      ask: 'full catalog pie',
      proposal: {
        template: 'part-to-whole-pie-chart',
        title: 'pie',
        confidence: 0.9,
        bindings: [
          { slot_id: 'field_base_1', field: '[Superstore].[none:Region:nk]' },
          { slot_id: 'field_base_2', field: '[Superstore].[sum:Sales:qk]' },
        ],
      },
    });
    expect(body).toMatchObject({ applied: true, pie_slice_warning: { rows: 13 } });
    const m = /call bind-template with ask "([^"]+)" and worksheet "([^"]+)"/.exec(body.guidance);
    invariant(m, body.guidance);
    const bar = await h.call({ ask: m[1], worksheet: m[2] });
    expect(bar).toMatchObject({ applied: true, sheet_name: body.sheet_name });
    const sheet = extractSheetXml(h.live(), body.sheet_name);
    expect(sheet).toMatch(/<rows>\[Superstore\]\.\[none:Region:nk\]<\/rows>/);
    expect(sheet).toMatch(/<cols>\[Superstore\]\.\[sum:Sales:qk\]<\/cols>/);
  });

  it('a pie on a measure captioned "Top 5 Sales" gets the plain offer, never a call that adds top_n', async () => {
    const h = makeHarness(
      wb(ds('Superstore', `${dim}${meas('Metric', 'Top 5 Sales')}`)),
      ['Superstore'],
      ['Metric'],
    );
    const body = await h.call({
      ask: 'top5 caption pie',
      proposal: {
        template: 'part-to-whole-pie-chart',
        title: 'pie',
        confidence: 0.9,
        bindings: [
          { slot_id: 'field_base_1', field: '[Superstore].[none:Region:nk]' },
          { slot_id: 'field_base_2', field: '[Superstore].[sum:Metric:qk]' },
        ],
      },
    });
    expect(body).toMatchObject({ applied: true, pie_slice_warning: { rows: 13 } });
    const offer = /call bind-template with ask "([^"]+)" and worksheet "([^"]+)"/.exec(
      body.guidance,
    );
    expect(offer, body.guidance).toBeNull();
    expect(body.guidance).toContain('A sorted bar would read better; offer it to the user.');
  });
});
