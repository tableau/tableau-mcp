import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  MockOverride,
  startMockExternalApiServer,
} from '../../../desktop/externalApi/mockExternalApiServer.js';
import { ExternalApiInstance } from '../../../desktop/externalApi/types.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getShowMeTool } from './showMe.js';

vi.mock('../../../desktop/session/sessionResolution.js');

const WORKSHEET_ID = 'sheet-sales';
const WORKSHEET_NAME = 'Sales by Region';
const SHOW_ME_REJECTIONS = [
  {
    code: 'show-me-not-applicable',
    message: 'The requested Show Me type is not applicable to the current worksheet context.',
  },
  {
    code: 'show-me-unavailable',
    message: 'The requested Show Me type is unavailable.',
  },
] as const;

const accepted202 = (operationId: string): MockOverride => ({
  status: 202,
  contentType: 'application/json',
  headers: {
    location: `/v0/operations/${operationId}`,
    'retry-after': '0',
    'x-tableau-operation-id': operationId,
  },
  body: JSON.stringify({ id: operationId, kind: 'tabdoc:show-me', state: 'RUNNING' }),
});

function showMePosts(server: MockExternalApiServer): Array<{ path: string; body: string }> {
  return server.requests.filter(
    (request) => request.method === 'POST' && request.path.includes(':showMe'),
  );
}

function resultBody(result: CallToolResult): Record<string, unknown> {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

describe('show-me tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('declares the route floor, workflow guidance, and an extensible Show Me type', async () => {
    const tool = getShowMeTool(new DesktopMcpServer());
    const paramsSchema = await Provider.from(tool.paramsSchema);

    expect(tool.minApiVersion).toBe('0.2.11');
    expect(tool.description).toContain('First call get-show-me-options');
    expect(tool.description).toContain('marked applicable');
    expect(tool.description).toContain('reuse its worksheet, data source, and selected fields');
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(paramsSchema.showMeType.safeParse('native-future-viz').success).toBe(true);
    expect(paramsSchema.showMeType.safeParse('').success).toBe(false);
  });

  it('lets Desktop validate a future non-empty Show Me type and surfaces its 400 response', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({
        worksheet: WORKSHEET_ID,
        showMeType: 'native-future-viz',
      });

      expect(result.isError).toBe(true);
      expect(showMePosts(harness.server)).toHaveLength(1);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('showMe requires a supported `showMeType`');
    } finally {
      await harness.close();
    }
  });

  it.each([
    [{ showMeType: 'bar-horiz' }, { showMeType: 'bar-horiz' }],
    [
      { showMeType: 'bar-horiz', dataSource: 'Sample - Superstore' },
      { showMeType: 'bar-horiz', dataSource: 'Sample - Superstore' },
    ],
    [
      { showMeType: 'bar-horiz', fieldsSelectedInSchemaViewer: [] },
      { showMeType: 'bar-horiz', fieldsSelectedInSchemaViewer: [] },
    ],
    [
      {
        showMeType: 'scatter',
        fieldsSelectedInSchemaViewer: ['[Superstore].[Sales]', '[Superstore].[Profit]'],
      },
      {
        showMeType: 'scatter',
        fieldsSelectedInSchemaViewer: ['[Superstore].[Sales]', '[Superstore].[Profit]'],
      },
    ],
    [
      {
        showMeType: 'scatter',
        dataSource: 'Sample - Superstore',
        fieldsSelectedInSchemaViewer: ['[Superstore].[Sales]', '[Superstore].[Profit]'],
      },
      {
        showMeType: 'scatter',
        dataSource: 'Sample - Superstore',
        fieldsSelectedInSchemaViewer: ['[Superstore].[Sales]', '[Superstore].[Profit]'],
      },
    ],
  ])('posts the closed Show Me body %#', async (args, expectedBody) => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ worksheet: WORKSHEET_NAME, ...args });
      expect(result.isError).toBe(false);
      const posts = showMePosts(harness.server);
      expect(posts).toHaveLength(1);
      expect(posts[0].path).toBe(`/v0/workbook/worksheets/${WORKSHEET_ID}:showMe`);
      expect(JSON.parse(posts[0].body)).toEqual(expectedBody);
      expect(resultBody(result)).toMatchObject({
        showMeRequested: true,
        operationStatus: 'completed',
        worksheet: { id: WORKSHEET_ID, name: WORKSHEET_NAME },
      });
    } finally {
      await harness.close();
    }
  });

  it('resolves a worksheet stable id and percent-encodes it in the action route', async () => {
    const harness = await startHarness();
    harness.server.setOverride('GET /v0/workbook/worksheets', {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        worksheets: [
          { id: 'sheet a/b', name: 'Encoded Sheet', hidden: false, isActiveSheet: false },
        ],
      }),
    });
    harness.server.setOverride('POST /v0/workbook/worksheets/sheet%20a%2Fb:showMe', {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'op-show-me-encoded',
        kind: 'tabdoc:show-me',
        state: 'succeeded',
        result: {},
      }),
    });
    try {
      const result = await harness.callTool({ worksheet: 'sheet a/b', showMeType: 'text' });
      expect(result.isError).toBe(false);
      expect(showMePosts(harness.server)[0].path).toBe(
        '/v0/workbook/worksheets/sheet%20a%2Fb:showMe',
      );
    } finally {
      await harness.close();
    }
  });

  it('polls a 202 Show Me operation to completion', async () => {
    const harness = await startHarness();
    const route = `/v0/workbook/worksheets/${WORKSHEET_ID}:showMe`;
    harness.server.setOverride(`POST ${route}`, accepted202('op-show-me'));
    harness.server.setOperation('op-show-me', {
      retryAfterSeconds: 0,
      poll: [{ id: 'op-show-me', kind: 'tabdoc:show-me', state: 'SUCCEEDED', result: {} }],
    });
    try {
      const result = await harness.callTool({ worksheet: WORKSHEET_ID, showMeType: 'heat' });
      expect(result.isError).toBe(false);
      expect(resultBody(result)).toMatchObject({
        showMeRequested: true,
        operationStatus: 'completed',
      });
      expect(
        harness.server.requests.some((request) => request.path === '/v0/operations/op-show-me'),
      ).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it.each(SHOW_ME_REJECTIONS)(
    'returns an MCP error for an immediate 409 $code Problem',
    async ({ code, message }) => {
      const harness = await startHarness();
      harness.server.setOverride(`POST /v0/workbook/worksheets/${WORKSHEET_ID}:showMe`, {
        status: 409,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: `https://tableau.com/problems/${code}`,
          title: 'Show Me could not be applied.',
          status: 409,
          detail: message,
          instance: `/v0/workbook/worksheets/${WORKSHEET_ID}:showMe`,
          code,
        }),
      });
      try {
        const result = await harness.callTool({
          worksheet: WORKSHEET_ID,
          showMeType: 'heat',
        });

        expect(result.isError).toBe(true);
        invariant(result.content[0].type === 'text');
        expect(result.content[0].text).toContain(message);
        expect(result.content[0].text).not.toContain('showMeRequested');
      } finally {
        await harness.close();
      }
    },
  );

  it.each(SHOW_ME_REJECTIONS)(
    'returns an MCP error when a 202 operation later fails with $code',
    async ({ code, message }) => {
      const harness = await startHarness();
      const operationId = `op-${code}`;
      const route = `/v0/workbook/worksheets/${WORKSHEET_ID}:showMe`;
      harness.server.setOverride(`POST ${route}`, accepted202(operationId));
      harness.server.setOperation(operationId, {
        retryAfterSeconds: 0,
        poll: [
          {
            id: operationId,
            kind: 'tabdoc:show-me',
            state: 'FAILED',
            error: { code, message },
          },
        ],
      });
      try {
        const result = await harness.callTool({
          worksheet: WORKSHEET_ID,
          showMeType: 'heat',
        });

        expect(result.isError).toBe(true);
        invariant(result.content[0].type === 'text');
        expect(result.content[0].text).toContain(message);
        expect(result.content[0].text).not.toContain('showMeRequested');
        expect(
          harness.server.requests.some(
            (request) => request.path === `/v0/operations/${operationId}`,
          ),
        ).toBe(true);
      } finally {
        await harness.close();
      }
    },
  );

  it('reports a pending executor result without claiming visual verification', async () => {
    const listWorksheets = vi
      .fn()
      .mockResolvedValue(new Ok({ worksheets: [{ id: WORKSHEET_ID, name: WORKSHEET_NAME }] }));
    const showMeWorksheet = vi
      .fn()
      .mockResolvedValue(
        new Ok({ command_id: 'show-me', status: 'running' as const, result: null }),
      );
    const result = await callWithExecutor(
      { listWorksheets, showMeWorksheet },
      {
        worksheet: WORKSHEET_NAME,
        showMeType: 'heat',
      },
    );

    expect(result.isError).toBe(false);
    expect(sessionResolution.resolveSession).toHaveBeenCalledTimes(1);
    expect(resultBody(result)).toMatchObject({ showMeRequested: true, operationStatus: 'running' });
    expect(String(resultBody(result).message)).toContain('still applying');
  });

  it('maps a missing endpoint to route-upgrade guidance', async () => {
    const harness = await startHarness();
    harness.server.setOverride(`POST /v0/workbook/worksheets/${WORKSHEET_ID}:showMe`, {
      status: 404,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        code: 'not-found',
        status: 404,
        instance: '/v0/mock',
        title: 'No route matches Show Me.',
        detail: 'No route matches Show Me.',
      }),
    });
    try {
      const result = await harness.callTool({ worksheet: WORKSHEET_ID, showMeType: 'text' });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('does not serve the show-me endpoint');
    } finally {
      await harness.close();
    }
  });

  it('rejects an unknown worksheet without dispatching', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ worksheet: 'Missing Sheet', showMeType: 'text' });
      expect(result.isError).toBe(true);
      expect(showMePosts(harness.server)).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });

  it('serializes worksheet resolution and dispatch through the apply mutex', async () => {
    let release!: () => void;
    const dispatched = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markDispatched!: () => void;
    const firstDispatched = new Promise<void>((resolve) => {
      markDispatched = resolve;
    });
    const listWorksheets = vi
      .fn()
      .mockResolvedValue(new Ok({ worksheets: [{ id: WORKSHEET_ID, name: WORKSHEET_NAME }] }));
    let dispatchCount = 0;
    const showMeWorksheet = vi.fn(async () => {
      dispatchCount += 1;
      if (dispatchCount === 1) {
        markDispatched();
        await dispatched;
      }
      return new Ok({ command_id: 'show-me', status: 'completed' as const, result: null });
    });
    const executor = { listWorksheets, showMeWorksheet };
    const first = callWithExecutor(executor, { worksheet: WORKSHEET_NAME, showMeType: 'text' });
    await firstDispatched;
    const second = callWithExecutor(executor, { worksheet: WORKSHEET_NAME, showMeType: 'heat' });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(listWorksheets).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(listWorksheets).toHaveBeenCalledTimes(2);
  });
});

async function startHarness(): Promise<{
  server: MockExternalApiServer;
  callTool: (args: Record<string, unknown>) => Promise<CallToolResult>;
  close: () => Promise<void>;
}> {
  const server = await startMockExternalApiServer();
  const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
  await executor.start();
  return {
    server,
    callTool: async (args) => await callWithExecutor(executor, args),
    close: async () => {
      executor.stop();
      await server.close();
    },
  };
}

async function callWithExecutor(
  executor: unknown,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const tool = getShowMeTool(new DesktopMcpServer());
  const callback = (await Provider.from(tool.callback)) as (
    args: Record<string, unknown>,
    extra: ReturnType<typeof getMockRequestHandlerExtra>,
  ) => Promise<CallToolResult>;
  return await callback(args, {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue(executor),
  });
}

function instanceFor(server: MockExternalApiServer): ExternalApiInstance {
  return {
    baseUrl: server.baseUrl,
    token: 'valid-token',
    pid: 999,
    instanceId: 'inst-show-me',
    apiVersion: '0.2.11',
  };
}
