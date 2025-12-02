import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { Server } from '../../server.js';
import { Provider } from '../../utils/provider.js';
import { exportedForTesting as resourceAccessCheckerExportedForTesting } from '../resourceAccessChecker.js';
import { getGenerateWorkbookXmlTool } from './generateWorkbookXml.js';

const { resetResourceAccessCheckerSingleton } = resourceAccessCheckerExportedForTesting;

const mocks = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
}));

vi.mock('../../config.js', () => ({
  getConfig: mocks.mockGetConfig,
}));

describe('generateWorkbookXmlTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetResourceAccessCheckerSingleton();
    mocks.mockGetConfig.mockReturnValue({
      server: 'https://my-tableau-server.com',
      siteName: 'tc25',
      datasourceCredentials: undefined,
      boundedContext: {
        projectIds: null,
        datasourceIds: null,
        workbookIds: null,
      },
    });
  });

  it('should create a tool instance with correct properties', () => {
    const generateWorkbookXmlTool = getGenerateWorkbookXmlTool(new Server());
    expect(generateWorkbookXmlTool.name).toBe('generate-workbook-xml');
    expect(generateWorkbookXmlTool.description).toContain(
      'Generates a Tableau TWB (workbook) XML string that connects to a specified published datasource (Data Server). Use the output to save a .twb file.',
    );
    expect(generateWorkbookXmlTool.paramsSchema).toMatchObject({});
  });

  it('should successfully create a workbook', async () => {
    const result = await getToolResult({
      datasourceName: 'test-datasource',
      publishedDatasourceId: 'test-published-datasource-id',
      datasourceCaption: 'test-datasource-caption',
      revision: '1.0',
      worksheetName: 'test-worksheet',
    });

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("<?xml version='1.0' encoding='utf-8' ?>");
    expect(result.content[0].text).toContain(
      "<workbook original-version='18.1' source-build='0.0.0 (0000.0.0.0)' source-platform='win' version='18.1' xmlns:user='http://www.tableausoftware.com/xml/user'>",
    );
  });

  it('should return data source not allowed error when datasource is not allowed', async () => {
    mocks.mockGetConfig.mockReturnValue({
      datasourceCredentials: undefined,
      boundedContext: {
        projectIds: null,
        datasourceIds: new Set(['some-other-datasource-luid']),
        workbookIds: null,
      },
    });

    const result = await getToolResult({
      datasourceName: 'test-datasource',
      publishedDatasourceId: 'test-published-datasource-id',
      datasourceCaption: 'test-datasource-caption',
      revision: '1.0',
      worksheetName: 'test-worksheet',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      [
        'The set of allowed data sources that can be used to generate a workbook is limited by the server configuration.',
        'Generating a workbook using the datasource with LUID test-published-datasource-id is not allowed.',
      ].join(' '),
    );
  });
});

async function getToolResult(params: {
  datasourceName: string;
  publishedDatasourceId: string;
  datasourceCaption: string;
  revision: string;
  worksheetName: string;
}): Promise<CallToolResult> {
  const generateWorkbookXmlTool = getGenerateWorkbookXmlTool(new Server());
  const callback = await Provider.from(generateWorkbookXmlTool.callback);
  return await callback(params, {
    signal: new AbortController().signal,
    requestId: 'test-request-id',
    sendNotification: vi.fn(),
    sendRequest: vi.fn(),
  });
}
