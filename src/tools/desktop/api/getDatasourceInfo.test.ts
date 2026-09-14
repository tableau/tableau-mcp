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
import { getDatasourceInfoTool } from './getDatasourceInfo.js';

vi.mock('../../../desktop/session/sessionResolution.js');

describe('getDatasourceInfoTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('defines the version-gated credential-safe metadata tool', async () => {
    const tool = getDatasourceInfoTool(new DesktopMcpServer());
    const paramsSchema = await Provider.from(tool.paramsSchema);

    expect(tool.name).toBe('get-datasource-info');
    expect(tool.minApiVersion).toBe('0.2.10');
    expect(tool.title).toBe('Get Datasource Info');
    expect(tool.description).toBe(
      'Read metadata for one datasource in the open workbook by name or inventory id.',
    );
    expect(paramsSchema).toMatchObject({
      session: expect.any(Object),
      datasourceName: expect.any(Object),
    });
    expect(paramsSchema.datasourceName.description).toBe('Datasource name/id.');
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it.each([
    {
      label: 'exact encoded inventory id',
      datasource: { id: 'Sales%2FExtract', name: 'Slash source' },
      datasourceName: 'Sales%2FExtract',
      expectedPath: '/v0/workbook/datasources/Sales%2FExtract',
    },
    {
      label: 'unique name',
      datasource: { id: 'Sales%20Extract', name: 'Sales Extract' },
      datasourceName: 'Sales Extract',
      expectedPath: '/v0/workbook/datasources/Sales%20Extract',
    },
    {
      label: 'entity-encoded name',
      datasource: { id: 'Sales%252FExtract', name: 'Sales & Profit' },
      datasourceName: 'Sales &amp; Profit',
      expectedPath: '/v0/workbook/datasources/Sales%252FExtract',
    },
  ])(
    'resolves a datasource by $label before reading its metadata',
    async ({ datasource, datasourceName, expectedPath }) => {
      const harness = await startHarness([datasource]);
      try {
        const result = await harness.callTool({ datasourceName });

        expect(result.isError).toBe(false);
        expect(parseResult(result)).toMatchObject({
          id: datasource.id,
          name: datasource.name,
        });
        expect(requestPaths(harness.server)).toEqual(['/v0/workbook/datasources', expectedPath]);
      } finally {
        await harness.close();
      }
    },
  );

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
      const result = await harness.callTool({ datasourceName: 'Safe name' });

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
      expect(requestPaths(harness.server)).toEqual([
        '/v0/workbook/datasources',
        '/v0/workbook/datasources/safe-id',
      ]);
    } finally {
      await harness.close();
    }
  });

  it.each([
    {
      label: 'ambiguous name',
      datasourceName: 'Duplicate',
      datasources: [
        { id: 'first-id', name: 'Duplicate' },
        { id: 'second-id', name: 'Duplicate' },
      ],
      expectedMessage: 'matched multiple datasources',
    },
    {
      label: 'missing name',
      datasourceName: 'Missing',
      datasources: [{ id: 'sales-id', name: 'Sales' }],
      expectedMessage: 'Datasource "Missing" was not found',
    },
  ])(
    'returns the existing argument error for an $label without calling a granular route',
    async ({ datasourceName, datasources, expectedMessage }) => {
      const harness = await startHarness(datasources);
      try {
        const result = await harness.callTool({ datasourceName });

        expect(result.isError).toBe(true);
        expect(errorText(result)).toContain(expectedMessage);
        expect(requestPaths(harness.server)).toEqual(['/v0/workbook/datasources']);
      } finally {
        await harness.close();
      }
    },
  );

  it('reports a missing inventory route through the standard endpoint error', async () => {
    const harness = await startHarness([{ id: 'sales-id', name: 'Sales' }], (server) => {
      setRouteMissing(server, 'GET /v0/workbook/datasources');
    });

    try {
      const result = await harness.callTool({ datasourceName: 'Sales' });

      expect(result.isError).toBe(true);
      expect(errorText(result)).toContain('does not serve the workbook datasources endpoint');
      expect(errorText(result)).toContain('Do not retry');
      expect(requestPaths(harness.server)).toEqual(['/v0/workbook/datasources']);
    } finally {
      await harness.close();
    }
  });

  it('reports a missing granular route through the standard endpoint error', async () => {
    const harness = await startHarness([{ id: 'sales-id', name: 'Sales' }], (server) => {
      setRouteMissing(server, 'GET /v0/workbook/datasources/sales-id');
    });

    try {
      const result = await harness.callTool({ datasourceName: 'Sales' });

      expect(result.isError).toBe(true);
      expect(errorText(result)).toContain('does not serve the datasource metadata endpoint');
      expect(errorText(result)).toContain('Do not retry');
      expect(requestPaths(harness.server)).toEqual([
        '/v0/workbook/datasources',
        '/v0/workbook/datasources/sales-id',
      ]);
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
      const result = await harness.callTool({ datasourceName: 'Stale source' });

      expect(result.isError).toBe(true);
      expect(errorText(result)).toContain('Datasource not found: stale-id');
      expect(errorText(result)).toContain('tableau-error-code: datasource-not-found');
      expect(errorText(result)).not.toContain('does not serve');
      expect(requestPaths(harness.server)).toEqual([
        '/v0/workbook/datasources',
        '/v0/workbook/datasources/stale-id',
      ]);
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
  const tool = getDatasourceInfoTool(new DesktopMcpServer());
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
    instanceId: 'inst-datasource-info',
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
