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
import * as loggerModule from '../../../logging/logger.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getRefreshAutoUpdatesTool } from './refreshAutoUpdates.js';

vi.mock('../../../desktop/session/sessionResolution.js');

const DASHBOARD_ID = 'dash-exec';
const ROUTE = `/v0/workbook/dashboards/${DASHBOARD_ID}:refreshNow`;

beforeEach(() => {
  vi.spyOn(loggerModule, 'log').mockImplementation(() => {});
});

describe('refresh-auto-updates on a dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('POSTs the bodyless dashboard route', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ sheetId: DASHBOARD_ID, kind: 'dashboard' });

      expect(result.isError).toBe(false);
      expect(refreshRequests(harness.server)).toEqual([
        expect.objectContaining({
          method: 'POST',
          path: ROUTE,
          contentType: undefined,
          body: '',
        }),
      ]);
      expect(parseText(result)).toEqual({
        sheet: { id: DASHBOARD_ID, kind: 'dashboard' },
        outcome: 'COMPLETE',
        refreshed: [
          { worksheetId: 'sheet-sales', worksheetName: 'Sales by Region' },
          { worksheetId: 'sheet-profit', worksheetName: 'Profit by Category' },
        ],
        failed: [],
        message: `Refreshed auto-updates for dashboard "${DASHBOARD_ID}".`,
      });
      expect(result.structuredContent).toBeUndefined();
    } finally {
      await harness.close();
    }
  });

  it.each(['QUEUED', 'RUNNING'])(
    'reports a %s refresh as still applying through the real executor',
    async (state) => {
      const harness = await startHarness((server) => {
        server.setOverride(`POST ${ROUTE}`, {
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'op-dashboard-pending', kind: 'dashboard.refreshNow', state }),
        });
      });
      try {
        const result = await harness.callTool({ sheetId: DASHBOARD_ID, kind: 'dashboard' });

        expect(result.isError).toBe(false);
        expect(parseText(result)).toEqual({
          refreshed: false,
          sheet: { id: DASHBOARD_ID, kind: 'dashboard' },
          message: `Requested refreshing auto-updates for dashboard "${DASHBOARD_ID}"; Desktop is still applying it.`,
        });
      } finally {
        await harness.close();
      }
    },
  );

  it.each([
    ['PARTIAL with failures', 'PARTIAL', 2, 1, '2 worksheets refreshed, 1 failed'],
    ['COMPLETE with failures', 'COMPLETE', 1, 1, '1 worksheet refreshed, 1 failed'],
    ['FAILED with empty arrays', 'FAILED', 0, 0, '0 worksheets refreshed, 0 failed'],
    ['PARTIAL with empty failed', 'PARTIAL', 1, 0, '1 worksheet refreshed, 0 failed'],
  ] as const)(
    'names a SUCCEEDED %s outcome and attaches a review next action',
    async (_label, outcome, refreshedCount, failedCount, counts) => {
      const harness = await startHarness((server) => {
        server.setOverride(`POST ${ROUTE}`, {
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'op-dashboard-non-clean',
            kind: 'dashboard.refreshNow',
            state: 'SUCCEEDED',
            result: {
              outcome,
              refreshed: Array.from({ length: refreshedCount }, (_v, i) => ({
                worksheetId: `ok-${i}`,
                worksheetName: `Ok ${i}`,
              })),
              failed: Array.from({ length: failedCount }, (_v, i) => ({
                worksheetId: `bad-${i}`,
                worksheetName: `Bad ${i}`,
                code: 'refresh-attempt-failed',
                message: 'The refresh attempt failed.',
              })),
            },
          }),
        });
      });
      try {
        const result = await harness.callTool({ sheetId: DASHBOARD_ID, kind: 'dashboard' });
        const body = parseText(result);

        expect(result.isError).toBe(false);
        expect(body.message).toBe(
          `Desktop reported a ${outcome} refresh of auto-updates for dashboard "${DASHBOARD_ID}": ${counts}.`,
        );
        expect(body).toMatchObject({ outcome });
        expect(result.structuredContent).toHaveProperty('nextAction.kind', 'prefill');
        expect(result.structuredContent).toMatchObject({ message: body.message });
      } finally {
        await harness.close();
      }
    },
  );

  it('keeps the review next action and appends Desktop warnings on a non-clean outcome', async () => {
    const harness = await startHarness((server) => {
      server.setOverride(`POST ${ROUTE}`, {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'op-dashboard-warned',
          kind: 'dashboard.refreshNow',
          state: 'SUCCEEDED',
          warnings: [{ code: 'slow-refresh', message: 'Refresh was slow.' }],
          result: { outcome: 'PARTIAL', refreshed: [], failed: [] },
        }),
      });
    });
    try {
      const result = await harness.callTool({ sheetId: DASHBOARD_ID, kind: 'dashboard' });
      const body = parseText(result);

      expect(result.isError).toBe(false);
      expect(body.message).toContain(
        `Desktop reported a PARTIAL refresh of auto-updates for dashboard "${DASHBOARD_ID}": 0 worksheets refreshed, 0 failed, but Desktop reported 1 warning(s).`,
      );
      expect(body.message).toContain('Refresh was slow.');
      expect(body.warnings).toEqual([{ code: 'slow-refresh', message: 'Refresh was slow.' }]);
      expect(result.structuredContent).toMatchObject({
        message: body.message,
        warnings: [{ code: 'slow-refresh', message: 'Refresh was slow.' }],
        nextAction: { kind: 'prefill' },
      });
    } finally {
      await harness.close();
    }
  });

  it.each([
    [
      'PARTIAL',
      [{ worksheetId: 'sheet-sales', worksheetName: 'Sales by Region' }],
      [
        {
          worksheetId: 'sheet-profit',
          worksheetName: 'Profit by Category',
          code: 'model-invalid-after-refresh',
          message: 'The visual model remained invalid.',
        },
      ],
    ],
    [
      'FAILED',
      [],
      [
        {
          worksheetId: 'sheet-sales',
          worksheetName: 'Sales by Region',
          code: 'refresh-attempt-failed',
          message: 'The refresh attempt failed.',
        },
      ],
    ],
  ] as const)(
    'returns isError with the structured %s outcome and original API error',
    async (outcome, refreshed, failed) => {
      const harness = await startHarness((server) => {
        server.setOverride(`POST ${ROUTE}`, {
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'op-dashboard-failed',
            kind: 'dashboard.refreshNow',
            state: 'FAILED',
            createdAt: '2026-09-23T12:00:00Z',
            completedAt: '2026-09-23T12:00:01Z',
            error: {
              code: 'dashboard-refresh-now-failed',
              message: 'One or more dashboard worksheets failed to refresh.',
              tableauErrorCode: 'B1234567',
            },
            result: { outcome, refreshed, failed },
          }),
        });
      });
      try {
        const result = await harness.callTool({ sheetId: DASHBOARD_ID, kind: 'dashboard' });
        const body = parseText(result);

        expect(result.isError).toBe(true);
        expect(body).toMatchObject({
          sheet: { id: DASHBOARD_ID, kind: 'dashboard' },
          outcome,
          refreshed,
          failed,
          error: {
            code: 'dashboard-refresh-now-failed',
            message: 'One or more dashboard worksheets failed to refresh.',
            'tableau-error-code': 'B1234567',
          },
        });
        expect(result.structuredContent).toMatchObject(body);
        expect(result.structuredContent).toHaveProperty('nextAction.kind', 'prefill');
      } finally {
        await harness.close();
      }
    },
  );

  it('preserves a polled PARTIAL outcome in both MCP error channels', async () => {
    const partial = {
      outcome: 'PARTIAL',
      refreshed: [{ worksheetId: 'sheet-sales', worksheetName: 'Sales by Region' }],
      failed: [
        {
          worksheetId: 'sheet-profit',
          worksheetName: 'Profit by Category',
          code: 'model-invalid-after-refresh',
          message: 'The visual model remained invalid.',
        },
      ],
    };
    const harness = await startHarness((server) => {
      server.setOverride(`POST ${ROUTE}`, {
        status: 202,
        contentType: 'application/json',
        headers: { location: '/v0/operations/op-dashboard-partial-polled' },
        body: JSON.stringify({
          id: 'op-dashboard-partial-polled',
          kind: 'dashboard.refreshNow',
          state: 'RUNNING',
        }),
      });
      server.setOperation('op-dashboard-partial-polled', {
        retryAfterSeconds: 0,
        poll: [
          {
            id: 'op-dashboard-partial-polled',
            kind: 'dashboard.refreshNow',
            state: 'FAILED',
            error: {
              code: 'dashboard-refresh-now-failed',
              message: 'One target failed.',
            },
            result: partial,
          },
        ],
      });
    });
    try {
      const result = await harness.callTool({ sheetId: DASHBOARD_ID, kind: 'dashboard' });
      const body = parseText(result);

      expect(result.isError).toBe(true);
      expect(body).toMatchObject(partial);
      expect(result.structuredContent).toMatchObject(partial);
      expect(
        harness.server.requests.some(
          (request) =>
            request.method === 'GET' &&
            request.path === '/v0/operations/op-dashboard-partial-polled',
        ),
      ).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it('says nothing was refreshed when the refresh fails before any worksheet is attempted', async () => {
    const harness = await startHarness((server) => {
      server.setOverride(`POST ${ROUTE}`, {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'op-dashboard-no-result',
          kind: 'dashboard.refreshNow',
          state: 'FAILED',
          error: { code: 'dashboard-refresh-now-failed', message: 'The dashboard is closing.' },
        }),
      });
    });
    try {
      const result = await harness.callTool({ sheetId: DASHBOARD_ID, kind: 'dashboard' });

      expect(result.isError).toBe(true);
      expect(text(result)).toContain('The dashboard is closing.');
      expect(text(result)).toContain('nothing was refreshed');
    } finally {
      await harness.close();
    }
  });

  it('reports an invalid retained failure result as an invalid response', async () => {
    const harness = await startHarness((server) => {
      server.setOverride(`POST ${ROUTE}`, {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'op-dashboard-invalid',
          kind: 'dashboard.refreshNow',
          state: 'FAILED',
          error: { code: 'dashboard-refresh-now-failed', message: 'Refresh failed.' },
          result: { outcome: 'PARTIAL', refreshed: [] },
        }),
      });
    });
    try {
      const result = await harness.callTool({ sheetId: DASHBOARD_ID, kind: 'dashboard' });

      expect(result.isError).toBe(true);
      expect(text(result)).toContain('invalid-response');
      expect(result.structuredContent).toBeUndefined();
    } finally {
      await harness.close();
    }
  });

  it('classifies a stable missing-route response without confusing dashboard-not-found', async () => {
    const harness = await startHarness((server) => {
      server.setOverride(
        `POST ${ROUTE}`,
        problemResponse(404, 'not-found', 'No route matches the dashboard refresh request.'),
      );
    });
    try {
      const result = await harness.callTool({ sheetId: DASHBOARD_ID, kind: 'dashboard' });

      expect(result.isError).toBe(true);
      expect(text(result)).toContain('Desktop build does not serve');
      expect(text(result)).toContain('Do not retry');
    } finally {
      await harness.close();
    }
  });
});

type ToolArgs = {
  sheetId: string;
  kind: 'worksheet' | 'dashboard' | 'storyboard';
  session?: string;
};
type Harness = {
  server: MockExternalApiServer;
  callTool: (args: ToolArgs) => Promise<CallToolResult>;
  close: () => Promise<void>;
};

async function startHarness(
  configure?: (server: MockExternalApiServer) => void | Promise<void>,
): Promise<Harness> {
  const server = await startMockExternalApiServer();
  await configure?.(server);
  const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
  await executor.start();
  const callback = await Provider.from(getRefreshAutoUpdatesTool(new DesktopMcpServer()).callback);
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue(executor),
  };
  return {
    server,
    callTool: async ({ session, sheetId, kind }) =>
      await callback({ session, sheetId, kind }, extra),
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
    instanceId: 'inst-dashboard-refresh',
    apiVersion: '0.2.19',
  };
}

function refreshRequests(server: MockExternalApiServer): RecordedRequest[] {
  return server.requests.filter((request) => request.method === 'POST' && request.path === ROUTE);
}

function text(result: CallToolResult): string {
  invariant(result.content[0].type === 'text');
  return result.content[0].text;
}

function parseText(result: CallToolResult): Record<string, unknown> {
  return JSON.parse(text(result)) as Record<string, unknown>;
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
