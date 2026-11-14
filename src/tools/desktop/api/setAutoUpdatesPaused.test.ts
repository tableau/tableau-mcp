import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

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
import { getSetAutoUpdatesPausedTool } from './setAutoUpdatesPaused.js';

vi.mock('../../../desktop/session/sessionResolution.js');

// Seeded by mockExternalApiServer.
const WORKSHEET_ID = 'sheet-sales';
const WORKSHEET_NAME = 'Sales by Region';
const DASHBOARD_ID = 'dash-exec';
const DASHBOARD_NAME = 'Executive Dashboard';
const STORYBOARD_NAME = 'QBR Story';

describe('set-auto-updates-paused', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('pausing POSTs the worksheet :pauseAutoUpdates route body-less', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ sheet: WORKSHEET_NAME, isAutoUpdatesPaused: true });
      expect(result.isError).toBeFalsy();
      const posted = harness.server.requests.filter(
        (r) =>
          r.method === 'POST' &&
          r.path === `/v0/workbook/worksheets/${WORKSHEET_ID}:pauseAutoUpdates`,
      );
      expect(posted).toHaveLength(1);
      expect(posted[0].body).toBe('');
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('"paused":true');
    } finally {
      await harness.close();
    }
  });

  it('pausing routes a dashboard target to the dashboards path', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ sheet: DASHBOARD_NAME, isAutoUpdatesPaused: true });
      expect(result.isError).toBeFalsy();
      const posted = harness.server.requests.filter(
        (r) =>
          r.method === 'POST' &&
          r.path === `/v0/workbook/dashboards/${DASHBOARD_ID}:pauseAutoUpdates`,
      );
      expect(posted).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });

  it('resuming POSTs the worksheet :resumeAutoUpdates route body-less', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ sheet: WORKSHEET_ID, isAutoUpdatesPaused: false });
      expect(result.isError).toBeFalsy();
      const posted = harness.server.requests.filter(
        (r) =>
          r.method === 'POST' &&
          r.path === `/v0/workbook/worksheets/${WORKSHEET_ID}:resumeAutoUpdates`,
      );
      expect(posted).toHaveLength(1);
      expect(posted[0].body).toBe('');
      invariant(result.content[0].type === 'text');
      const body = JSON.parse(result.content[0].text);
      expect(body.resumed).toBe(true);
      // Worksheet resume affects only the named sheet — no dashboard blast-radius flag.
      expect(body).not.toHaveProperty('alsoResumedContainedWorksheets');
    } finally {
      await harness.close();
    }
  });

  it('resuming a dashboard surfaces the contained-worksheet blast radius in the result', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ sheet: DASHBOARD_NAME, isAutoUpdatesPaused: false });
      expect(result.isError).toBeFalsy();
      const posted = harness.server.requests.filter(
        (r) =>
          r.method === 'POST' &&
          r.path === `/v0/workbook/dashboards/${DASHBOARD_ID}:resumeAutoUpdates`,
      );
      expect(posted).toHaveLength(1);
      invariant(result.content[0].type === 'text');
      const body = JSON.parse(result.content[0].text);
      expect(body.alsoResumedContainedWorksheets).toBe(true);
      expect(body.message).toContain('every worksheet it contains');
    } finally {
      await harness.close();
    }
  });

  it.each([true, false])(
    'rejects a storyboard target without dispatching (isAutoUpdatesPaused %s)',
    async (isAutoUpdatesPaused) => {
      const harness = await startHarness();
      try {
        const result = await harness.callTool({ sheet: STORYBOARD_NAME, isAutoUpdatesPaused });
        expect(result.isError).toBe(true);
        invariant(result.content[0].type === 'text');
        expect(result.content[0].text).toContain('storyboard');
        const posted = harness.server.requests.filter(
          (r) => r.method === 'POST' && /AutoUpdates$/.test(r.path),
        );
        expect(posted).toHaveLength(0);
      } finally {
        await harness.close();
      }
    },
  );
});

type Harness = {
  server: MockExternalApiServer;
  callTool: (args: Record<string, unknown>) => Promise<CallToolResult>;
  close: () => Promise<void>;
};

async function startHarness(): Promise<Harness> {
  const server = await startMockExternalApiServer();
  const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
  await executor.start();
  const tool = getSetAutoUpdatesPausedTool(new DesktopMcpServer());
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

function instanceFor(server: MockExternalApiServer): ExternalApiInstance {
  return {
    baseUrl: server.baseUrl,
    token: 'valid-token',
    pid: 999,
    instanceId: 'inst-auto-updates',
    apiVersion: '0.2.5',
  };
}
