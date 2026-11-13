import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Err, Ok } from 'ts-results-es';

import { Config } from '../../../../config.desktop.js';
import type { ExternalApiToolExecutor } from '../../../../desktop/externalApi/externalApiToolExecutor.js';
import { parseXML } from '../../../../desktop/metadata/parser.js';
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

const WORKSHEET_NAME = /<worksheet\b[^>]*\bname=['"]([^'"]+)['"]/g;
const worksheetNames = (xml: string): string[] =>
  [...xml.matchAll(WORKSHEET_NAME)].map((m) => m[1]);

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

describe('bind-template offered sorted-bar replacement (real binder + injector)', () => {
  let templatesDir: string;

  beforeEach(() => {
    templatesDir = mkdtempSync(join(tmpdir(), 'bind-pie-replace-'));
    vi.stubEnv('TEMPLATES_DIR', templatesDir);
    vi.stubEnv('TABLEAU_DESKTOP_SESSION_ID', '7');
    for (const template of ['part-to-whole-pie-chart', 'ranking-ordered-bar']) {
      writeFileSync(
        join(templatesDir, `${template}.tbm`),
        readFileSync(join(process.cwd(), `src/desktop/data/templates/${template}.tbm`), 'utf8'),
      );
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(templatesDir, { recursive: true, force: true });
  });

  it('replaces the flagged pie in place with a descending ranking bar', async () => {
    let liveXml = WORKBOOK_XML;
    const applyWorkbookDocument = vi.fn(async (xml: string) => {
      liveXml = xml;
      return Ok({ command_id: 'apply', status: 'completed', submitted_at: '', result: {} });
    });
    const executor = {
      desktopInstanceId: 'inst-test',
      desktopApiVersion: '0.2.16',
      applyWorkbookDocument,
      getWorkbookDocument: vi.fn(async () =>
        Ok({ xml: liveXml, applicationVersion: undefined, xsdPayloadVersion: undefined }),
      ),
      listWorksheets: vi.fn(async () =>
        Ok({
          worksheets: listWorksheetRefs(liveXml).map(({ id, name }) => ({
            id,
            name,
            datasources: ['Superstore'],
          })),
        }),
      ),
      getWorksheetDiagnostics: vi.fn(async (worksheetId: string) =>
        Ok({ worksheets: [{ worksheetId, status: 'complete', invalidFields: [] }] }),
      ),
      // Older Desktop without the per-sheet route: readback falls back to the workbook document.
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
            { name: 'Sales', dataType: 'real' },
          ],
          rows: Array.from({ length: 13 }, (_, i) => [`Region ${i}`, i * 10]).slice(
            0,
            options.maxRows,
          ),
        }),
      ),
    };
    const callback = await Provider.from(getBindTemplateTool(new DesktopMcpServer()).callback);
    const extra = {
      ...getMockRequestHandlerExtra(),
      config: new Config(),
      getExecutor: vi.fn(async () => executor as unknown as ExternalApiToolExecutor),
    };

    const pie = await callback(
      { session: '7', ask: 'pie chart of Sales by Region', auto_apply: true } as any,
      extra,
    );
    invariant(pie.content[0].type === 'text');
    const pieBody = JSON.parse(pie.content[0].text);
    expect(pieBody).toMatchObject({ applied: true, pie_slice_warning: { rows: 13 } });
    const offered = /call bind-template with ask "([^"]+)" and target_worksheet "([^"]+)"/.exec(
      pieBody.guidance,
    );
    invariant(offered, `no concrete offer in: ${pieBody.guidance}`);
    const [, offeredAsk, offeredTarget] = offered;
    const pieSheetName = pieBody.sheet_name as string;
    expect(offeredTarget).toBe(pieBody.worksheet_id);
    expect(extractSheetXml(liveXml, pieSheetName)).toMatch(/<mark class=['"]Pie['"]/);

    const bar = await callback(
      {
        session: '7',
        ask: offeredAsk,
        auto_apply: true,
        target_worksheet: offeredTarget,
      } as any,
      extra,
    );
    invariant(bar.content[0].type === 'text');
    const barBody = JSON.parse(bar.content[0].text);
    expect(barBody).toMatchObject({ applied: true, sheet_name: pieSheetName });
    expect(barBody.pie_slice_warning).toBeUndefined();

    expect(worksheetNames(liveXml).sort()).toEqual([pieSheetName, 'Untouched'].sort());
    // Each apply reserializes the document (quotes, xmlns:user, whitespace), so compare by content.
    const untouched = extractSheetXml(liveXml, 'Untouched');
    invariant(untouched);
    const content = (xml: string): unknown =>
      parseXML(xml.replace(/ xmlns:user="[^"]*"/, '').replace(/>\s+</g, '><'));
    expect(content(untouched)).toEqual(content(OTHER_SHEET));
    const barSheet = extractSheetXml(liveXml, pieSheetName);
    invariant(barSheet);
    expect(barSheet).not.toMatch(/<mark class=['"]Pie['"]/);
    expect(barBody.completionEvidence).toMatchObject({
      application: { template: 'ranking-ordered-bar', sheetName: pieSheetName },
    });
    // ranking-ordered-bar draws its bar from the shelves (Automatic mark), sorted DESC by the measure.
    expect(barSheet).toMatch(/<mark class=['"]Automatic['"]/);
    expect(barSheet).toMatch(/<rows>\[Superstore\]\.\[none:Region:nk\]<\/rows>/);
    expect(barSheet).toMatch(/<cols>\[Superstore\]\.\[sum:Sales:qk\]<\/cols>/);
    expect(barSheet).toMatch(
      /<computed-sort column=['"]\[Superstore\]\.\[none:Region:nk\]['"] direction=['"]DESC['"] using=['"]\[Superstore\]\.\[sum:Sales:qk\]['"]/,
    );
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

  const PLAIN_OFFER = 'A sorted bar would read better; offer it to the user.';

  const pieProposal = (
    ds_: string,
    measure = 'sum:Sales:qk',
    dim_ = 'none:Region:nk',
  ): Record<string, unknown> => ({
    template: 'part-to-whole-pie-chart',
    title: 'pie',
    confidence: 0.9,
    bindings: [
      { slot_id: 'field_base_1', field: `[${ds_}].[${dim_}]` },
      {
        slot_id: 'field_base_2',
        field: measure.includes(':') ? `[${ds_}].[${measure}]` : measure,
      },
    ],
  });
  const concreteOffer = (body: any): [string, string] | undefined => {
    const m = /call bind-template with ask "([^"]+)" and target_worksheet "([^"]+)"/.exec(
      body.guidance,
    );
    return m ? [m[1], m[2]] : undefined;
  };
  const setTemplate = (name: string, edit: (xml: string) => string): void => {
    const path = join(templatesDir, `${name}.tbm`);
    writeFileSync(path, edit(readFileSync(path, 'utf8')));
  };
  const toAvg = (xml: string): string =>
    xml
      .replace(/derivation='Sum'/g, "derivation='Avg'")
      .replace(/\[sum:/g, '[avg:')
      .replace(/:sum:/g, ':avg:');

  it('gives the plain offer when a caption collision would rebind the bar to another field', async () => {
    const h = makeHarness(
      wb(ds('Superstore', `${dim}${meas('Sales')}${meas('Commission', 'Sales')}`)),
      ['Superstore'],
      ['Sales'],
    );
    const body = await h.call({ ask: 'collision pie', proposal: pieProposal('Superstore') });
    expect(body).toMatchObject({ applied: true, pie_slice_warning: { rows: 13 } });
    expect(body.guidance).toContain(PLAIN_OFFER);
    expect(concreteOffer(body)).toBeUndefined();
  });

  it('control: a clean pie gets a concrete offer that rebuilds the same fields', async () => {
    const h = makeHarness(
      wb(ds('Superstore', `${dim}${meas('Sales')}`)),
      ['Superstore'],
      ['Sales'],
    );
    const body = await h.call({ ask: 'clean pie', proposal: pieProposal('Superstore') });
    const offer = concreteOffer(body);
    invariant(offer, body.guidance);
    const bar = await h.call({ ask: offer[0], target_worksheet: offer[1] });
    expect(bar).toMatchObject({ applied: true, sheet_name: body.sheet_name });
    const sheet = extractSheetXml(h.live(), body.sheet_name);
    expect(sheet).toMatch(/<rows>\[Superstore\]\.\[none:Region:nk\]<\/rows>/);
    expect(sheet).toMatch(/<cols>\[Superstore\]\.\[sum:Sales:qk\]<\/cols>/);
  });

  it('gives the plain offer when the pie is AVG-authored and the stock bar sums', async () => {
    setTemplate('part-to-whole-pie-chart', toAvg);
    const h = makeHarness(
      wb(ds('Superstore', `${dim}${meas('Sales')}`)),
      ['Superstore'],
      ['Sales'],
    );
    const body = await h.call({
      ask: 'avg pie',
      proposal: pieProposal('Superstore', 'Sales'),
    });
    expect(body).toMatchObject({ applied: true, pie_slice_warning: { rows: 13 } });
    expect(concreteOffer(body)).toBeUndefined();
    expect(body.guidance).toContain(PLAIN_OFFER);
  });

  it('gives the plain offer when the pie sums and the bar template defaults to AVG', async () => {
    setTemplate('ranking-ordered-bar', toAvg);
    const h = makeHarness(
      wb(ds('Superstore', `${dim}${meas('Sales')}`)),
      ['Superstore'],
      ['Sales'],
    );
    const body = await h.call({ ask: 'sum pie', proposal: pieProposal('Superstore') });
    expect(body).toMatchObject({ applied: true, pie_slice_warning: { rows: 13 } });
    expect(concreteOffer(body)).toBeUndefined();
    expect(body.guidance).toContain(PLAIN_OFFER);
  });

  it('offers concretely when pie and bar both default to AVG', async () => {
    setTemplate('part-to-whole-pie-chart', toAvg);
    setTemplate('ranking-ordered-bar', toAvg);
    const h = makeHarness(
      wb(ds('Superstore', `${dim}${meas('Sales')}`)),
      ['Superstore'],
      ['Sales'],
    );
    const body = await h.call({
      ask: 'avg both pie',
      proposal: pieProposal('Superstore', 'Sales'),
    });
    expect(concreteOffer(body)).toBeDefined();
  });

  it('gives the plain offer when two datasources hold the same fields and the bar goes elsewhere', async () => {
    const h = makeHarness(
      wb(
        ds('Superstore', `${dim}${meas('Sales')}`),
        ds('Superstore Copy', `${dim}${meas('Sales')}`),
      ),
      ['Superstore', 'Superstore Copy'],
      ['Sales'],
    );
    const body = await h.call({
      ask: 'two source pie',
      proposal: pieProposal('Superstore Copy'),
      datasource: 'Superstore Copy',
    });
    expect(body).toMatchObject({ applied: true, pie_slice_warning: { rows: 13 } });
    expect(concreteOffer(body)).toBeUndefined();
    expect(body.guidance).toContain(PLAIN_OFFER);
  });
});
