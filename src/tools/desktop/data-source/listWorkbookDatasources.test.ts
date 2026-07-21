import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  startMockExternalApiServer,
} from '../../../desktop/externalApi/mockExternalApiServer.js';
import { ExternalApiInstance } from '../../../desktop/externalApi/types.js';
import * as sessionResolution from '../../../desktop/sessionResolution.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getListWorkbookDatasourcesTool } from './listWorkbookDatasources.js';

vi.mock('../../../desktop/sessionResolution.js');

const resultSchema = z.object({
  datasources: z.array(
    z.object({
      id: z.string().optional(),
      name: z.string().optional(),
      caption: z.string().optional(),
    }),
  ),
});

describe('listWorkbookDatasourcesTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('creates a workbook datasource read tool with no public args', () => {
    const tool = getListWorkbookDatasourcesTool(new DesktopMcpServer());

    expect(tool.name).toBe('list-workbook-datasources');
    expect(tool.description).toContain("workbook's OWN connected datasources");
    expect(tool.description).toContain('pair with list-site-datasources');
    expect(tool.paramsSchema).toEqual({});
    expect(tool.annotations).toMatchObject({
      title: 'List Workbook Datasources',
      readOnlyHint: true,
      openWorldHint: false,
    });
  });

  it('returns datasources connected to the open workbook', async () => {
    const server = await startMockExternalApiServer();
    const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
    await executor.start();

    try {
      const tool = getListWorkbookDatasourcesTool(new DesktopMcpServer());
      const callback = await Provider.from(tool.callback);
      const extra = {
        ...getMockRequestHandlerExtra(),
        getExecutor: vi.fn().mockResolvedValue(executor),
      };

      const result = await callback({}, extra);

      expect(result.isError).toBe(false);
      expect(parseResult(result).datasources).toEqual([
        { id: 'wb-ds-superstore', name: 'Sample - Superstore', caption: 'Sample - Superstore' },
        { id: 'wb-ds-quota', name: 'Quota Targets', caption: 'Quota Targets' },
      ]);
      expect(server.requests.at(-1)?.path).toBe('/v0/workbook/datasources');
    } finally {
      executor.stop();
      await server.close();
    }
  });
});

function instanceFor(server: MockExternalApiServer): ExternalApiInstance {
  return {
    baseUrl: server.baseUrl,
    token: 'valid-token',
    pid: 999,
    instanceId: 'inst-workbook-datasources',
    apiVersion: '1.0',
  };
}

function parseResult(result: CallToolResult): z.infer<typeof resultSchema> {
  invariant(result.content[0].type === 'text');
  return resultSchema.parse(JSON.parse(result.content[0].text));
}
