import { z } from 'zod';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  startMockExternalApiServer,
} from '../../../desktop/externalApi/mockExternalApiServer.js';
import { ExternalApiInstance } from '../../../desktop/externalApi/types.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getGetDashboardXmlTool } from './getDashboardXml.js';

const inlineResultSchema = z.object({
  message: z.string(),
  dashboardXml: z.string(),
});

describe('getDashboardXmlTool with External Client API transport', () => {
  let server: MockExternalApiServer;

  beforeEach(async () => {
    vi.clearAllMocks();
    server = await startMockExternalApiServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('uses dashboard list + per-item document routes without fetching the whole workbook', async () => {
    const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
    await executor.start();

    const tool = getGetDashboardXmlTool(new DesktopMcpServer());
    const callback = await Provider.from(tool.callback);
    const result = await callback(
      { session: '999', dashboardName: 'Executive Dashboard', mode: 'inline' },
      { ...getMockRequestHandlerExtra(), getExecutor: vi.fn().mockResolvedValue(executor) },
    );

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(inlineResultSchema.parse(JSON.parse(result.content[0].text)).dashboardXml).toContain(
      '<dashboard name="Executive Dashboard"',
    );
    expect(server.requests.map((request) => request.path)).toEqual([
      '/v0/workbook/dashboards',
      '/v0/workbook/dashboards/dash-exec/document',
    ]);
    expect(server.requests.map((request) => request.path)).not.toContain('/v0/workbook/document');
  });

  it('reports a clear old-build error when the dashboard document route is missing', async () => {
    server.setOverride('GET /v0/workbook/dashboards/dash-exec/document', {
      status: 404,
      body: JSON.stringify({
        code: 'not-found',
        status: 404,
        instance: '/v0/mock',
        title: 'No route matches GET /v0/workbook/dashboards/dash-exec/document',
        detail: 'No route matches GET /v0/workbook/dashboards/dash-exec/document',
      }),
    });
    const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
    await executor.start();

    const tool = getGetDashboardXmlTool(new DesktopMcpServer());
    const callback = await Provider.from(tool.callback);
    const result = await callback(
      { session: '999', dashboardName: 'Executive Dashboard', mode: 'inline' },
      { ...getMockRequestHandlerExtra(), getExecutor: vi.fn().mockResolvedValue(executor) },
    );

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('does not serve the dashboard document endpoint');
  });
});

const instanceFor = (server: MockExternalApiServer): ExternalApiInstance => ({
  baseUrl: server.baseUrl,
  token: 'valid-token',
  pid: 999,
  instanceId: 'inst-tool-dashboard',
  apiVersion: '1.0',
});
