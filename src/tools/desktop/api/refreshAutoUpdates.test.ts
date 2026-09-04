import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  MockOverride,
  RecordedRequest,
  startMockExternalApiServer,
} from '../../../desktop/externalApi/mockExternalApiServer.js';
import { ExternalApiInstance } from '../../../desktop/externalApi/types.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getRefreshAutoUpdatesTool } from './refreshAutoUpdates.js';

vi.mock('../../../desktop/session/sessionResolution.js');

const WORKSHEET_ID = 'sheet-sales';
const WORKSHEET_NAME = 'Sales by Region';
const DASHBOARD_NAME = 'Executive Dashboard';
const STORYBOARD_NAME = 'QBR Story';
const REFRESH_ROUTE = `/v0/workbook/worksheets/${WORKSHEET_ID}:refreshNow`;

describe('refresh-auto-updates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('defines the worksheet refresh contract and mutating non-idempotent annotations', () => {
    const tool = getRefreshAutoUpdatesTool(new DesktopMcpServer());

    expect(tool.name).toBe('refresh-auto-updates');
    expect(tool.minApiVersion).toBe('0.2.11');
    expect(tool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it('resolves a worksheet name and POSTs its exact bodyless refresh route', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ worksheet: WORKSHEET_NAME });

      expect(result.isError).toBe(false);
      const posted = refreshRequests(harness.server);
      expect(posted).toHaveLength(1);
      expect(posted[0]).toMatchObject({
        method: 'POST',
        path: REFRESH_ROUTE,
        contentType: undefined,
        body: '',
      });
      expect(parseResult(result)).toEqual({
        refreshed: true,
        worksheet: { id: WORKSHEET_ID, name: WORKSHEET_NAME },
        message: `Refreshed auto-updates for worksheet "${WORKSHEET_NAME}".`,
      });
    } finally {
      await harness.close();
    }
  });

  it('resolves a stable worksheet id before dispatching refresh', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ worksheet: WORKSHEET_ID });

      expect(result.isError).toBe(false);
      expect(refreshRequests(harness.server)).toHaveLength(1);
      expect(parseResult(result).worksheet).toEqual({ id: WORKSHEET_ID, name: WORKSHEET_NAME });
    } finally {
      await harness.close();
    }
  });

  it.each([
    ['dashboard', DASHBOARD_NAME],
    ['storyboard', STORYBOARD_NAME],
  ] as const)('rejects a %s without dispatching refresh', async (kind, worksheet) => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ worksheet });

      expect(result.isError).toBe(true);
      expect(errorText(result)).toContain(`is a ${kind}`);
      expect(errorText(result)).toContain('only be refreshed on a worksheet');
      expect(refreshRequests(harness.server)).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });

  it('rejects a missing sheet without dispatching refresh', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ worksheet: 'Missing Sheet' });

      expect(result.isError).toBe(true);
      expect(errorText(result)).toContain('was not found');
      expect(refreshRequests(harness.server)).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });

  it('rejects an ambiguous worksheet name without dispatching refresh', async () => {
    const harness = await startHarness((server) => {
      server.setOverride('GET /v0/workbook/worksheets', {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          worksheets: [
            { id: 'sheet-a', name: 'Regional Sales', hidden: false, isActiveSheet: false },
            { id: 'sheet-b', name: 'Regional Sales', hidden: false, isActiveSheet: false },
          ],
        }),
      });
    });
    try {
      const result = await harness.callTool({ worksheet: 'Regional Sales' });

      expect(result.isError).toBe(true);
      expect(errorText(result)).toMatch(/matched multiple sheets.*sheet-a.*sheet-b/);
      expect(refreshRequests(harness.server)).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });

  it('reports a still-pending refresh without claiming it completed', async () => {
    const harness = await startHarness((server) => {
      server.setOverride(`POST ${REFRESH_ROUTE}`, {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'op-refresh-1',
          kind: 'tabdoc:run-updates',
          state: 'running',
          createdAt: '2026-09-03T12:00:00Z',
        }),
      });
    });
    try {
      const result = await harness.callTool({ worksheet: WORKSHEET_NAME });

      expect(result.isError).toBe(false);
      expect(parseResult(result)).toMatchObject({ refreshed: false });
      expect(parseResult(result).message).toContain('still applying');
    } finally {
      await harness.close();
    }
  });

  it('classifies route-missing by its stable code when the message is localized', async () => {
    const harness = await startHarness((server) => {
      server.setOverride(
        `POST ${REFRESH_ROUTE}`,
        problemResponse(
          404,
          'not-found',
          'Aucune route ne correspond a POST /v0/workbook/worksheets/sheet-sales:refreshNow',
        ),
      );
    });
    try {
      const result = await harness.callTool({ worksheet: WORKSHEET_NAME });

      expect(result.isError).toBe(true);
      expect(errorText(result)).toContain('Desktop build does not serve');
      expect(errorText(result)).toContain('Do not retry');
    } finally {
      await harness.close();
    }
  });

  it('maps a failed Operation to DesktopCommandExecutionError', async () => {
    const harness = await startHarness((server) => {
      server.setOverride(`POST ${REFRESH_ROUTE}`, {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'op-refresh-failed',
          kind: 'tabdoc:run-updates',
          state: 'failed',
          createdAt: '2026-09-03T12:00:00Z',
          completedAt: '2026-09-03T12:00:01Z',
          error: { code: 'operation-failed', message: 'Worksheet refresh failed.' },
        }),
      });
    });
    try {
      const result = await harness.callTool({ worksheet: WORKSHEET_NAME });

      expect(result.isError).toBe(true);
      expect(errorText(result)).toContain('Worksheet refresh failed.');
      expect(errorText(result)).not.toContain('Desktop build does not serve');
    } finally {
      await harness.close();
    }
  });

  it('maps a non-route endpoint error to DesktopCommandExecutionError', async () => {
    const harness = await startHarness((server) => {
      server.setOverride(
        `POST ${REFRESH_ROUTE}`,
        problemResponse(500, 'operation-failed', 'Host failed to refresh worksheet.'),
      );
    });
    try {
      const result = await harness.callTool({ worksheet: WORKSHEET_NAME });

      expect(result.isError).toBe(true);
      expect(errorText(result)).toContain('Host failed to refresh worksheet.');
      expect(errorText(result)).not.toContain('Desktop build does not serve');
    } finally {
      await harness.close();
    }
  });

  it('does not misclassify sheet-not-found as a missing route', async () => {
    const harness = await startHarness((server) => {
      server.setOverride(
        `POST ${REFRESH_ROUTE}`,
        problemResponse(404, 'sheet-not-found', `Worksheet not found: ${WORKSHEET_ID}`),
      );
    });
    try {
      const result = await harness.callTool({ worksheet: WORKSHEET_NAME });

      expect(result.isError).toBe(true);
      expect(errorText(result)).toContain(`Worksheet not found: ${WORKSHEET_ID}`);
      expect(errorText(result)).not.toContain('Desktop build does not serve');
    } finally {
      await harness.close();
    }
  });
});

type RefreshAutoUpdatesArgs = {
  worksheet: string;
  session?: string;
};

type Harness = {
  server: MockExternalApiServer;
  callTool: (args: RefreshAutoUpdatesArgs) => Promise<CallToolResult>;
  close: () => Promise<void>;
};

async function startHarness(
  configure?: (server: MockExternalApiServer) => void | Promise<void>,
): Promise<Harness> {
  const server = await startMockExternalApiServer();
  await configure?.(server);
  const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
  await executor.start();
  const tool = getRefreshAutoUpdatesTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue(executor),
  };

  return {
    server,
    callTool: async ({ session, worksheet }) => await callback({ session, worksheet }, extra),
    close: async () => {
      executor.stop();
      await server.close();
    },
  };
}

function instanceFor(server: MockExternalApiServer): ExternalApiInstance {
  return {
    baseUrl: server.baseUrl,
    token: 'valid-token',
    pid: 999,
    instanceId: 'inst-refresh-auto-updates',
    apiVersion: '0.2.11',
  };
}

function refreshRequests(server: MockExternalApiServer): RecordedRequest[] {
  return server.requests.filter(
    (request) => request.method === 'POST' && request.path.endsWith(':refreshNow'),
  );
}

type RefreshResult = {
  refreshed: boolean;
  worksheet: { id: string; name: string };
  message: string;
};

function parseResult(result: CallToolResult): RefreshResult {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text) as RefreshResult;
}

function errorText(result: CallToolResult): string {
  invariant(result.content[0].type === 'text');
  return result.content[0].text;
}

function problemResponse(status: number, code: string, detail: string): MockOverride {
  return {
    status,
    contentType: 'application/problem+json',
    body: JSON.stringify({
      type: 'problem',
      title: detail,
      status,
      instance: '/v0/mock',
      detail,
      code,
    }),
  };
}
