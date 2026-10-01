import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Err, Ok } from 'ts-results-es';

import { Config } from '../../../../config.desktop.js';
import type { ExternalApiToolExecutor } from '../../../../desktop/externalApi/externalApiToolExecutor.js';
import { getCompleteRequestTemplateIds } from '../../../../desktop/templates/runtimeTemplateCatalog.js';
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
  let previousTemplatesDir: string | undefined;

  beforeEach(() => {
    templatesDir = mkdtempSync(join(tmpdir(), 'bind-complete-callback-'));
    previousTemplatesDir = process.env['TEMPLATES_DIR'];
    process.env['TEMPLATES_DIR'] = templatesDir;
    vi.stubEnv('TABLEAU_DESKTOP_SESSION_SCOPE', 'strict');
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
    if (previousTemplatesDir === undefined) delete process.env['TEMPLATES_DIR'];
    else process.env['TEMPLATES_DIR'] = previousTemplatesDir;
    rmSync(templatesDir, { recursive: true, force: true });
  });

  it('computes completion proof for an advertised ask and declines a later unadvertised template without writing', async () => {
    const server = new DesktopMcpServer();
    expect(server.getCompleteRequestTemplateIds()).toEqual(['ranking-ordered-bar']);

    writeFileSync(
      join(templatesDir, 'distribution-histogram.tbm'),
      readFileSync(
        join(process.cwd(), 'src/desktop/data/templates/distribution-histogram.tbm'),
        'utf8',
      ),
    );
    expect(getCompleteRequestTemplateIds()).toContain('distribution-histogram');
    expect(server.getCompleteRequestTemplateIds()).toEqual(['ranking-ordered-bar']);

    let liveXml = WORKBOOK_XML;
    const applyWorkbookDocument = vi.fn(async (xml: string) => {
      liveXml = xml;
      return Ok({ command_id: 'apply-1', status: 'completed', submitted_at: '', result: {} });
    });
    const executor = {
      desktopInstanceId: 'inst-test',
      desktopApiVersion: '0.2.16',
      applyWorkbookDocument,
      executeCommand: vi.fn(async () =>
        Ok({ command_id: 'focus-1', status: 'completed', submitted_at: '', result: {} }),
      ),
      getWorkbookDocument: vi.fn(async () =>
        Ok({ xml: liveXml, applicationVersion: undefined, xsdPayloadVersion: undefined }),
      ),
      listWorksheets: vi.fn(async () =>
        Err({
          type: 'command-failed' as const,
          error: { code: 'not-found', message: 'No route matches /worksheets' },
        }),
      ),
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
    const writesAfterSupported = {
      apply: applyWorkbookDocument.mock.calls.length,
      command: executor.executeCommand.mock.calls.length,
    };

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
    expect({
      apply: applyWorkbookDocument.mock.calls.length,
      command: executor.executeCommand.mock.calls.length,
    }).toEqual(writesAfterSupported);
  });
});
