import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  RecordedRequest,
  startMockExternalApiServer,
} from '../../../desktop/externalApi/mockExternalApiServer.js';
import { ExternalApiInstance } from '../../../desktop/externalApi/types.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getRefreshStoryboardAutoUpdatesTool } from './refreshStoryboardAutoUpdates.js';

vi.mock('../../../desktop/session/sessionResolution.js');

const STORYBOARD_ID = 'story-qbr';
const STORYBOARD_NAME = 'QBR Story';
const WORKSHEET_NAME = 'Sales by Region';
const DASHBOARD_NAME = 'Executive Dashboard';
const REFRESH_ROUTE = `/v0/workbook/storyboards/${STORYBOARD_ID}:refreshNow`;

describe('refresh-storyboard-auto-updates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('defines the storyboard refresh contract and version floor', () => {
    const tool = getRefreshStoryboardAutoUpdatesTool(new DesktopMcpServer());

    expect(tool.name).toBe('refresh-storyboard-auto-updates');
    expect(tool.minApiVersion).toBe('0.2.20');
    expect(tool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it('resolves a storyboard name and returns the exact public result without a receipt', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ storyboard: STORYBOARD_NAME });

      expect(result.isError).toBe(false);
      expect(refreshRequests(harness.server)).toHaveLength(1);
      expect(refreshRequests(harness.server)[0]).toMatchObject({
        method: 'POST',
        path: REFRESH_ROUTE,
        contentType: undefined,
        body: '',
      });
      expect(parseResult(result)).toEqual({
        storyboard: { id: STORYBOARD_ID, name: STORYBOARD_NAME },
        outcome: 'COMPLETE',
        refreshed: [{ worksheetId: 'sheet-sales', worksheetName: 'Sales by Region' }],
        failed: [],
        message: `Refreshed auto-updates for the current point of storyboard "${STORYBOARD_NAME}".`,
      });
      expect(JSON.stringify(parseResult(result))).not.toContain('operation');
    } finally {
      await harness.close();
    }
  });

  it('resolves a stable storyboard id before dispatching refresh', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ storyboard: STORYBOARD_ID });

      expect(result.isError).toBe(false);
      expect(refreshRequests(harness.server)).toHaveLength(1);
      expect(parseResult(result).storyboard).toEqual({ id: STORYBOARD_ID, name: STORYBOARD_NAME });
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
          id: 'op-storyboard-refresh-running',
          kind: 'storyboard.refreshNow',
          state: 'RUNNING',
          createdAt: '2026-09-23T12:00:00Z',
        }),
      });
    });
    try {
      const result = await harness.callTool({ storyboard: STORYBOARD_NAME });

      expect(result.isError).toBe(false);
      expect(parseResult(result).refreshed).toBe(false);
      expect(parseResult(result).message).toContain('still applying');
    } finally {
      await harness.close();
    }
  });

  it.each([
    ['worksheet', WORKSHEET_NAME],
    ['dashboard', DASHBOARD_NAME],
  ] as const)('rejects a %s without dispatching refresh', async (kind, storyboard) => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ storyboard });

      expect(result.isError).toBe(true);
      expect(errorText(result)).toContain(`is a ${kind}`);
      expect(errorText(result)).toContain('only be refreshed on a storyboard');
      expect(refreshRequests(harness.server)).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });

  it('rejects a missing sheet without dispatching refresh', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ storyboard: 'Missing Story' });

      expect(result.isError).toBe(true);
      expect(errorText(result)).toContain('was not found');
      expect(refreshRequests(harness.server)).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });

  it('rejects an ambiguous storyboard name without dispatching refresh', async () => {
    const harness = await startHarness((server) => {
      server.setOverride('GET /v0/workbook/storyboards', {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          storyboards: [
            { id: 'story-a', name: 'Quarterly Review', hidden: false, isActiveSheet: false },
            { id: 'story-b', name: 'Quarterly Review', hidden: false, isActiveSheet: false },
          ],
        }),
      });
    });
    try {
      const result = await harness.callTool({ storyboard: 'Quarterly Review' });

      expect(result.isError).toBe(true);
      expect(errorText(result)).toMatch(/matched multiple sheets.*story-a.*story-b/);
      expect(refreshRequests(harness.server)).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });

  it('maps a failed refresh operation to DesktopCommandExecutionError', async () => {
    const harness = await startHarness((server) => {
      server.setOverride(`POST ${REFRESH_ROUTE}`, {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'op-storyboard-refresh-failed',
          kind: 'tabdoc:run-updates',
          state: 'failed',
          createdAt: '2026-09-23T12:00:00Z',
          completedAt: '2026-09-23T12:00:01Z',
          error: { code: 'operation-failed', message: 'Storyboard refresh failed.' },
        }),
      });
    });
    try {
      const result = await harness.callTool({ storyboard: STORYBOARD_NAME });

      expect(result.isError).toBe(true);
      expect(errorText(result)).toContain('Storyboard refresh failed.');
      expect(errorText(result)).not.toContain('Desktop build does not serve');
    } finally {
      await harness.close();
    }
  });

  it.each([
    ['PARTIAL', [{ worksheetId: 'sheet-sales', worksheetName: 'Sales by Region' }]],
    ['FAILED', []],
  ] as const)(
    'preserves a %s current-point outcome and per-worksheet failures',
    async (outcome, refreshed) => {
      const failed = [
        {
          worksheetId: 'sheet-profit',
          worksheetName: 'Profit by Category',
          code: 'model-invalid-after-refresh',
          message: 'The worksheet model remained invalid after refresh.',
        },
      ];
      const harness = await startHarness((server) => {
        server.setOverride(`POST ${REFRESH_ROUTE}`, {
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'op-storyboard-refresh-incomplete',
            kind: 'storyboard.refreshNow',
            state: 'FAILED',
            error: {
              code: 'storyboard-refresh-now-failed',
              message: 'One or more storyboard worksheets could not be refreshed.',
              tableauErrorCode: '4D60D278',
            },
            result: { outcome, refreshed, failed },
          }),
        });
      });
      try {
        const result = await harness.callTool({ storyboard: STORYBOARD_NAME });
        const body = parseResult(result);

        expect(result.isError).toBe(true);
        expect(body).toMatchObject({
          storyboard: { id: STORYBOARD_ID, name: STORYBOARD_NAME },
          outcome,
          refreshed,
          failed,
          error: { code: 'storyboard-refresh-now-failed', 'tableau-error-code': '4D60D278' },
        });
        expect(result.structuredContent).toMatchObject(body);
        expect(result.structuredContent).toHaveProperty('nextAction.kind', 'prefill');
      } finally {
        await harness.close();
      }
    },
  );

  it('retains a polled partial current-point result', async () => {
    const operationId = 'op-storyboard-partial-polled';
    const partial = {
      outcome: 'PARTIAL',
      refreshed: [{ worksheetId: 'sheet-sales', worksheetName: 'Sales by Region' }],
      failed: [
        {
          worksheetId: 'sheet-profit',
          worksheetName: 'Profit by Category',
          code: 'refresh-attempt-failed',
          message: 'The worksheet refresh attempt failed.',
        },
      ],
    };
    const harness = await startHarness((server) => {
      server.setOverride(`POST ${REFRESH_ROUTE}`, {
        status: 202,
        contentType: 'application/json',
        headers: { location: `/v0/operations/${operationId}` },
        body: JSON.stringify({ id: operationId, kind: 'storyboard.refreshNow', state: 'RUNNING' }),
      });
      server.setOperation(operationId, {
        retryAfterSeconds: 0,
        poll: [
          {
            id: operationId,
            kind: 'storyboard.refreshNow',
            state: 'FAILED',
            error: { code: 'storyboard-refresh-now-failed', message: 'One worksheet failed.' },
            result: partial,
          },
        ],
      });
    });
    try {
      const result = await harness.callTool({ storyboard: STORYBOARD_NAME });

      expect(result.isError).toBe(true);
      expect(parseResult(result)).toMatchObject(partial);
      expect(result.structuredContent).toMatchObject(partial);
      expect(
        harness.server.requests.some((request) => request.path === `/v0/operations/${operationId}`),
      ).toBe(true);
    } finally {
      await harness.close();
    }
  });
});

type RefreshStoryboardArgs = {
  storyboard: string;
  session?: string;
};

type Harness = {
  server: MockExternalApiServer;
  callTool: (args: RefreshStoryboardArgs) => Promise<CallToolResult>;
  close: () => Promise<void>;
};

async function startHarness(
  configure?: (server: MockExternalApiServer) => void | Promise<void>,
): Promise<Harness> {
  const server = await startMockExternalApiServer();
  await configure?.(server);
  const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
  await executor.start();
  const tool = getRefreshStoryboardAutoUpdatesTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue(executor),
  };

  return {
    server,
    callTool: async ({ session, storyboard }) => await callback({ session, storyboard }, extra),
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
    instanceId: 'inst-refresh-storyboard-auto-updates',
    apiVersion: '0.2.20',
  };
}

function refreshRequests(server: MockExternalApiServer): RecordedRequest[] {
  return server.requests.filter(
    (request) => request.method === 'POST' && request.path.endsWith(':refreshNow'),
  );
}

type RefreshResult = {
  refreshed: boolean | { worksheetId: string; worksheetName: string }[];
  storyboard: { id: string; name: string };
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
