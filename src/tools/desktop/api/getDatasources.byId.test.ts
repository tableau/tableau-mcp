import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  startMockExternalApiServer,
} from '../../../desktop/externalApi/mockExternalApiServer.js';
import { DatasourceItem, ExternalApiInstance } from '../../../desktop/externalApi/types.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getDatasourcesTool } from './getDatasources.js';

vi.mock('../../../desktop/session/sessionResolution.js');

describe('get-datasources with datasourceId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it.each([
    { label: 'plain', id: 'sales-id', expectedPath: '/v0/workbook/datasources/sales-id' },
    {
      label: 'percent-encoded',
      id: 'Sales%2FExtract',
      expectedPath: '/v0/workbook/datasources/Sales%2FExtract',
    },
  ])('reads a $label datasource id straight from its route', async ({ id, expectedPath }) => {
    const harness = await startHarness([{ id, name: 'Sales' }]);
    try {
      const result = await harness.callTool({ datasourceId: id });

      expect(result.isError).toBe(false);
      expect(parseResult(result)).toMatchObject({ id, name: 'Sales' });
      expect(requestPaths(harness.server)).toEqual([expectedPath]);
    } finally {
      await harness.close();
    }
  });

  it('drops null and unknown credential-shaped fields from a real granular response', async () => {
    const secretValues = [
      'secret-password-value',
      'secret-credential-value',
      'secret-token-value',
      'secret-oauth-value',
      'secret-nested-value',
    ];
    const harness = await startHarness([{ id: 'safe-id', name: 'Safe name' }], (server) => {
      server.setOverride('GET /v0/workbook/datasources/safe-id', {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'safe-id',
          luid: null,
          name: 'Safe name',
          caption: 'Safe caption',
          type: 'relational',
          isExtract: false,
          hasDownloadFilePermission: null,
          password: secretValues[0],
          credential: { value: secretValues[1] },
          token: secretValues[2],
          oauth: { clientSecret: secretValues[3] },
          nested: { connection: { password: secretValues[4] } },
        }),
      });
    });

    try {
      const result = await harness.callTool({ datasourceId: 'safe-id' });

      expect(result.isError).toBe(false);
      expect(parseResult(result)).toEqual({
        id: 'safe-id',
        name: 'Safe name',
        caption: 'Safe caption',
        type: 'relational',
        isExtract: false,
      });
      const serialized = JSON.stringify(result);
      for (const secret of secretValues) {
        expect(serialized).not.toContain(secret);
      }
      expect(requestPaths(harness.server)).toEqual(['/v0/workbook/datasources/safe-id']);
    } finally {
      await harness.close();
    }
  });

  it('reports a missing granular route through the standard endpoint error', async () => {
    const harness = await startHarness([{ id: 'sales-id', name: 'Sales' }], (server) => {
      setRouteMissing(server, 'GET /v0/workbook/datasources/sales-id');
    });

    try {
      const result = await harness.callTool({ datasourceId: 'sales-id' });

      expect(result.isError).toBe(true);
      expect(errorText(result)).toContain('does not serve the datasource metadata endpoint');
      expect(errorText(result)).toContain('Do not retry');
      expect(requestPaths(harness.server)).toEqual(['/v0/workbook/datasources/sales-id']);
    } finally {
      await harness.close();
    }
  });

  it('keeps a real granular datasource-not-found distinct from route absence', async () => {
    const harness = await startHarness([{ id: 'stale-id', name: 'Stale source' }], (server) => {
      server.setOverride('GET /v0/workbook/datasources/stale-id', {
        status: 404,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'problem',
          title: 'Datasource not found',
          status: 404,
          instance: '/v0/mock',
          detail: 'Datasource not found: stale-id',
          code: 'datasource-not-found',
        }),
      });
    });

    try {
      const result = await harness.callTool({ datasourceId: 'stale-id' });

      expect(result.isError).toBe(true);
      expect(errorText(result)).toContain('Datasource not found: stale-id');
      expect(errorText(result)).toContain('tableau-error-code: datasource-not-found');
      expect(errorText(result)).not.toContain('does not serve');
      expect(requestPaths(harness.server)).toEqual(['/v0/workbook/datasources/stale-id']);
    } finally {
      await harness.close();
    }
  });
});

async function startHarness(
  datasources: Array<DatasourceItem>,
  configure?: (server: MockExternalApiServer) => void,
): Promise<{
  server: MockExternalApiServer;
  callTool: (args: Record<string, unknown>) => Promise<CallToolResult>;
  close: () => Promise<void>;
}> {
  const server = await startMockExternalApiServer({ workbookDatasources: datasources });
  configure?.(server);
  const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
  await executor.start();
  const tool = getDatasourcesTool(new DesktopMcpServer());
  const callback = (await Provider.from(tool.callback)) as (
    args: Record<string, unknown>,
    extra: ReturnType<typeof getMockRequestHandlerExtra>,
  ) => Promise<CallToolResult>;
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue(executor),
  };

  return {
    server,
    callTool: async (args) => await callback(args, extra),
    close: async () => {
      executor.stop();
      await server.close();
    },
  };
}

function setRouteMissing(server: MockExternalApiServer, key: string): void {
  server.setOverride(key, {
    status: 404,
    contentType: 'application/problem+json',
    body: JSON.stringify({
      type: 'problem',
      title: `No route matches ${key}`,
      status: 404,
      instance: '/v0/mock',
      detail: `No route matches ${key}`,
      code: 'not-found',
    }),
  });
}

function instanceFor(server: MockExternalApiServer): ExternalApiInstance {
  return {
    baseUrl: server.baseUrl,
    token: 'valid-token',
    pid: 999,
    instanceId: 'inst-datasource-by-id',
    apiVersion: '0.2.10',
  };
}

function requestPaths(server: MockExternalApiServer): Array<string> {
  return server.requests.map((request) => request.path);
}

function parseResult(result: CallToolResult): unknown {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text);
}

function errorText(result: CallToolResult): string {
  invariant(result.content[0].type === 'text');
  return result.content[0].text;
}
