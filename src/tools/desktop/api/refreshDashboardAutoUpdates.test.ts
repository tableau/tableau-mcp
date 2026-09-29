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
import { getRefreshDashboardAutoUpdatesTool } from './refreshDashboardAutoUpdates.js';

vi.mock('../../../desktop/session/sessionResolution.js');

const DASHBOARD_ID = 'dash-exec';
const DASHBOARD_NAME = 'Executive Dashboard';
const ROUTE = `/v0/workbook/dashboards/${DASHBOARD_ID}:refreshNow`;

describe('refresh-dashboard-auto-updates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('declares the dashboard refresh contract and API floor', () => {
    const tool = getRefreshDashboardAutoUpdatesTool(new DesktopMcpServer());

    expect(tool.name).toBe('refresh-dashboard-auto-updates');
    expect(tool.minApiVersion).toBe('0.2.19');
    expect(tool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it.each([
    ['name', DASHBOARD_NAME],
    ['stable id', DASHBOARD_ID],
  ])('resolves a dashboard by %s and POSTs the bodyless route', async (_label, dashboard) => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ dashboard });

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
        dashboard: { id: DASHBOARD_ID, name: DASHBOARD_NAME },
        outcome: 'COMPLETE',
        refreshed: [
          { worksheetId: 'sheet-sales', worksheetName: 'Sales by Region' },
          { worksheetId: 'sheet-profit', worksheetName: 'Profit by Category' },
        ],
        failed: [],
        message: `Refreshed auto-updates for dashboard "${DASHBOARD_NAME}".`,
      });
      expect(
        harness.server.requests.some((request) => request.path === '/v0/workbook/worksheets'),
      ).toBe(false);
      expect(
        harness.server.requests.some((request) => request.path === '/v0/workbook/storyboards'),
      ).toBe(false);
    } finally {
      await harness.close();
    }
  });

  it('rejects a worksheet name using only the dashboard inventory', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ dashboard: 'Sales by Region' });

      expect(result.isError).toBe(true);
      expect(text(result)).toContain('Dashboard "Sales by Region" was not found');
      expect(refreshRequests(harness.server)).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });

  it('rejects an ambiguous dashboard name before dispatch', async () => {
    const harness = await startHarness((server) => {
      server.setOverride('GET /v0/workbook/dashboards', {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          dashboards: [
            { id: 'dash-a', name: 'Overview', hidden: false },
            { id: 'dash-b', name: 'Overview', hidden: false },
          ],
        }),
      });
    });
    try {
      const result = await harness.callTool({ dashboard: 'Overview' });

      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/matched multiple dashboards.*dash-a.*dash-b/);
      expect(refreshRequests(harness.server)).toHaveLength(0);
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
        const result = await harness.callTool({ dashboard: DASHBOARD_NAME });
        const body = parseText(result);

        expect(result.isError).toBe(true);
        expect(body).toMatchObject({
          dashboard: { id: DASHBOARD_ID, name: DASHBOARD_NAME },
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
      const result = await harness.callTool({ dashboard: DASHBOARD_NAME });
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
      const result = await harness.callTool({ dashboard: DASHBOARD_NAME });

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
      const result = await harness.callTool({ dashboard: DASHBOARD_NAME });

      expect(result.isError).toBe(true);
      expect(text(result)).toContain('Desktop build does not serve');
      expect(text(result)).toContain('Do not retry');
    } finally {
      await harness.close();
    }
  });
});

type ToolArgs = { dashboard: string; session?: string };
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
  const callback = await Provider.from(
    getRefreshDashboardAutoUpdatesTool(new DesktopMcpServer()).callback,
  );
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue(executor),
  };
  return {
    server,
    callTool: async ({ session, dashboard }) => await callback({ session, dashboard }, extra),
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
