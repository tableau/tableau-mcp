import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Err, Ok } from 'ts-results-es';

import { Config } from '../../../../config.desktop.js';
import type { ExternalApiToolExecutor } from '../../../../desktop/externalApi/externalApiToolExecutor.js';
import { parseXML } from '../../../../desktop/metadata/parser.js';
import { extractSheetXml } from '../../../../desktop/metadata/sheets.js';
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
          worksheets: worksheetNames(liveXml).map((name) => ({
            id: `id-${name}`,
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
    expect(offeredTarget).toBe(pieSheetName);
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
});
