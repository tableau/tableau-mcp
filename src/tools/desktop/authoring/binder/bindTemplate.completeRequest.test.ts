import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Ok } from 'ts-results-es';

import { Config } from '../../../../config.desktop.js';
import type { ExternalApiToolExecutor } from '../../../../desktop/externalApi/externalApiToolExecutor.js';
import { extractSheetXml, listWorksheetRefs } from '../../../../desktop/metadata/sheets.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getBindTemplateTool } from './bindTemplate.js';

const WORKBOOK_XML = `<?xml version='1.0' encoding='utf-8'?>
<workbook>
  <datasources>
    <datasource name='Superstore'>
      <column caption='Region' name='[Region]' role='dimension' type='nominal' datatype='string' />
      <column caption='Sales' name='[Sales]' role='measure' type='quantitative' datatype='real' />
    </datasource>
  </datasources>
  <worksheets />
  <windows />
</workbook>`;

describe('bind-template public complete-request callback', () => {
  let templatesDir: string;

  beforeEach(() => {
    templatesDir = mkdtempSync(join(tmpdir(), 'bind-complete-callback-'));
    vi.stubEnv('TEMPLATES_DIR', templatesDir);
    vi.stubEnv('TABLEAU_DESKTOP_SESSION_ID', '7');
    writeFileSync(
      join(templatesDir, 'ranking-ordered-bar.tbm'),
      readFileSync(
        join(process.cwd(), 'src/desktop/data/templates/ranking-ordered-bar.tbm'),
        'utf8',
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(templatesDir, { recursive: true, force: true });
  });

  it('computes completion proof for a provable ask and declines an unprovable ask without writing', async () => {
    const server = new DesktopMcpServer();

    let liveXml = WORKBOOK_XML;
    const applyWorkbookDocument = vi.fn(async (xml: string) => {
      liveXml = xml;
      return Ok({ command_id: 'apply-1', status: 'completed', submitted_at: '', result: {} });
    });
    const executor = {
      desktopInstanceId: 'inst-test',
      applyWorkbookDocument,
      getWorkbookDocument: vi.fn(async () =>
        Ok({ xml: liveXml, applicationVersion: undefined, xsdPayloadVersion: undefined }),
      ),
      listWorksheets: vi.fn(async () =>
        Ok({
          worksheets: listWorksheetRefs(liveXml).map((ref) => ({ ...ref, hidden: false })),
        }),
      ),
      getWorksheetDocument: vi.fn(async (id: string) => {
        const ref = listWorksheetRefs(liveXml).find((sheet) => sheet.id === id);
        return Ok({ xml: (ref && extractSheetXml(liveXml, ref.name)) ?? '' });
      }),
      getWorksheetDiagnostics: vi.fn(async (worksheetId: string) =>
        Ok({ worksheets: [{ worksheetId, status: 'complete', invalidFields: [] }] }),
      ),
      getWorksheetSummaryData: vi.fn(async () =>
        Ok({
          columns: [
            { name: 'Region', dataType: 'string' },
            { name: 'Sales', dataType: 'real' },
          ],
          rows: [['West', 10]],
        }),
      ),
    };
    const tool = getBindTemplateTool(server);
    const callback = await Provider.from(tool.callback);
    const requestExtra = getMockRequestHandlerExtra();
    const extra = {
      ...requestExtra,
      config: new Config(),
      getExecutor: vi.fn(async () => executor as unknown as ExternalApiToolExecutor),
    };

    const supported = await callback(
      {
        session: '7',
        ask: 'bar chart of Sales by Region',
        auto_apply: true,
        requireCompleteRequest: true,
      } as any,
      extra,
    );
    expect(supported.isError).toBe(false);
    expect(supported.structuredContent).toMatchObject({
      applied: true,
      requestCoverage: { version: 1, kind: 'complete_single_sheet_binding' },
      completionEvidence: { coverage: 'complete_request' },
      nextAction: { kind: 'done' },
    });
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
    const writesAfterSupported = applyWorkbookDocument.mock.calls.length;

    const declined = await callback(
      {
        session: '7',
        ask: 'histogram of Sales',
        auto_apply: true,
        requireCompleteRequest: true,
      } as any,
      extra,
    );
    expect(declined.isError).toBe(false);
    expect(declined.structuredContent).toMatchObject({
      applied: false,
      writeAttempts: 0,
      requestCoverage: { version: 1, kind: 'declined' },
    });
    expect(applyWorkbookDocument.mock.calls.length).toBe(writesAfterSupported);
  });
});
