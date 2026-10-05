import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  startMockExternalApiServer,
} from '../../../desktop/externalApi/mockExternalApiServer.js';
import { ExternalApiInstance } from '../../../desktop/externalApi/types.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getListWorkbookDatasourcesTool } from './listWorkbookDatasources.js';

vi.mock('../../../desktop/session/sessionResolution.js');

const resultSchema = z.object({
  datasources: z.array(
    z.object({
      id: z.string().optional(),
      luid: z.string().optional(),
      name: z.string().optional(),
      caption: z.string().optional(),
      type: z.string().optional(),
      isExtract: z.boolean().optional(),
      hasDownloadFilePermission: z.boolean().optional(),
    }),
  ),
});

describe('listWorkbookDatasourcesTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('creates a workbook datasource read tool with an optional session arg', () => {
    const tool = getListWorkbookDatasourcesTool(new DesktopMcpServer());

    expect(tool.name).toBe('list-workbook-datasources');
    expect(tool.description).toContain("workbook's OWN connected datasources");
    expect(tool.description).toContain('isExtract');
    expect(tool.description).toContain('published, non-federated');
    expect(tool.paramsSchema).toMatchObject({ session: expect.any(Object) });
    expect(tool.annotations).toMatchObject({
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

      const result = await callback({ session: undefined }, extra);

      expect(result.isError).toBe(false);
      // The published datasource surfaces its server LUID and a real hasDownloadFilePermission; the
      // embedded one (luid: null, hasDownloadFilePermission: null) omits both, keeping isExtract:
      // false; the legacy one predates all three added fields (luid/type/isExtract/permission absent)
      // and omits each. Only a non-null string luid and a real boolean permission are projected.
      expect(parseResult(result).datasources).toEqual([
        {
          id: 'wb-ds-superstore',
          luid: 'luid-superstore',
          name: 'Sample - Superstore',
          caption: 'Sample - Superstore',
          type: 'relational',
          isExtract: true,
          hasDownloadFilePermission: true,
        },
        {
          id: 'wb-ds-quota',
          name: 'Quota Targets',
          caption: 'Quota Targets',
          type: 'federated',
          isExtract: false,
        },
        { id: 'wb-ds-legacy', name: 'Legacy Extract', caption: 'Legacy Extract' },
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
