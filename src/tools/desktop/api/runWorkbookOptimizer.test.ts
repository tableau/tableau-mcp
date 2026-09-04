import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

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
import { getRunWorkbookOptimizerTool } from './runWorkbookOptimizer.js';

vi.mock('../../../desktop/session/sessionResolution.js');

const accepted202 = (operationId: string): MockOverride => ({
  status: 202,
  contentType: 'application/json',
  headers: {
    location: `/v0/operations/${operationId}`,
    'retry-after': '0',
  },
  body: JSON.stringify({ id: operationId, kind: 'workbook.optimizer', state: 'RUNNING' }),
});

const resultSchema = z.object({
  suggestions: z.array(
    z.object({
      ruleId: z.number(),
      title: z.string(),
      description: z.string(),
      status: z.enum(['PASS', 'FAIL', 'NEEDS_REVIEW', 'IGNORED']),
      affected: z.object({
        count: z.number(),
        items: z.array(z.object({ name: z.string(), items: z.array(z.any()).optional() })),
      }),
    }),
  ),
});

describe('getRunWorkbookOptimizerTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('defines a read-only, version-gated tool with only the optional session selector', async () => {
    const tool = getRunWorkbookOptimizerTool(new DesktopMcpServer());
    const paramsSchema = await Provider.from(tool.paramsSchema);

    expect(tool.name).toBe('run-workbook-optimizer');
    expect(tool.minApiVersion).toBe('0.2.11');
    expect(Object.keys(paramsSchema)).toEqual(['session']);
    expect(paramsSchema.session.safeParse(undefined).success).toBe(true);
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('returns the complete synchronous optimizer result from the exact bodyless POST', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool();

      expect(result.isError).toBe(false);
      expect(parseResult(result).suggestions[0]).toMatchObject({ ruleId: 1, status: 'FAIL' });
      expect(harness.server.requests.at(-1)).toMatchObject({
        method: 'POST',
        path: '/v0/workbook:runWorkbookOptimizer',
        body: '',
        contentType: undefined,
      });
    } finally {
      await harness.close();
    }
  });

  it('returns additive optimizer response fields unchanged', async () => {
    const harness = await startHarness((server) => {
      server.setOverride('POST /v0/workbook:runWorkbookOptimizer', {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          suggestions: [
            {
              ruleId: 9,
              title: 'Keep all optimizer data',
              description: 'Future Desktop fields remain available to agents.',
              status: 'PASS',
              affected: {
                count: 1,
                items: [{ name: 'Worksheet', extraAffectedItemField: 'kept' }],
                extraAffectedField: 'kept',
              },
              extraSuggestionField: 'kept',
            },
          ],
          extraResultField: 'kept',
        }),
      });
    });
    try {
      const result = await harness.callTool();

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      expect(JSON.parse(result.content[0].text)).toMatchObject({
        extraResultField: 'kept',
        suggestions: [
          {
            extraSuggestionField: 'kept',
            affected: {
              extraAffectedField: 'kept',
              items: [{ extraAffectedItemField: 'kept' }],
            },
          },
        ],
      });
    } finally {
      await harness.close();
    }
  });

  it('polls an asynchronous optimizer dispatch and preserves recursive affected items', async () => {
    const harness = await startHarness((server) => {
      server.setOverride('POST /v0/workbook:runWorkbookOptimizer', accepted202('op-optimizer'));
      server.setOperation('op-optimizer', {
        retryAfterSeconds: 0,
        poll: [
          {
            id: 'op-optimizer',
            kind: 'workbook.optimizer',
            state: 'SUCCEEDED',
            result: {
              suggestions: [
                {
                  ruleId: 8,
                  title: 'Review calculations',
                  description: 'Calculations can become complex.',
                  status: 'NEEDS_REVIEW',
                  affected: {
                    count: 1,
                    items: [{ name: 'Worksheet', items: [{ name: 'Calculation' }] }],
                  },
                },
              ],
            },
          },
        ],
      });
    });
    try {
      const result = await harness.callTool();

      expect(result.isError).toBe(false);
      expect(parseResult(result).suggestions[0].affected.items[0].items).toEqual([
        { name: 'Calculation' },
      ]);
      expect(harness.server.requests).toContainEqual(
        expect.objectContaining({ path: '/v0/operations/op-optimizer' }),
      );
    } finally {
      await harness.close();
    }
  });

  it('funnels malformed results through the Desktop command error', async () => {
    const harness = await startHarness((server) => {
      server.setOverride('POST /v0/workbook:runWorkbookOptimizer', {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ suggestions: [{ ruleId: 0 }] }),
      });
    });
    try {
      const result = await harness.callTool();

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('"type":"invalid-response"');
    } finally {
      await harness.close();
    }
  });

  it('reports an honest too-new endpoint error when the route is absent', async () => {
    const harness = await startHarness((server) => {
      server.setOverride('POST /v0/workbook:runWorkbookOptimizer', {
        status: 404,
        body: JSON.stringify({
          code: 'not-found',
          title: 'No route matches the request path.',
          detail: 'No route matches the request path.',
        }),
      });
    });
    try {
      const result = await harness.callTool();

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('does not serve the workbook optimizer endpoint');
    } finally {
      await harness.close();
    }
  });
});

async function startHarness(
  configure?: (server: MockExternalApiServer) => void | Promise<void>,
): Promise<{
  server: MockExternalApiServer;
  callTool: () => Promise<CallToolResult>;
  close: () => Promise<void>;
}> {
  const server = await startMockExternalApiServer();
  await configure?.(server);
  const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
  await executor.start();
  const tool = getRunWorkbookOptimizerTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue(executor),
  };

  return {
    server,
    callTool: async () => await callback({ session: undefined }, extra),
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
    instanceId: 'inst-workbook-optimizer',
    apiVersion: '0.2.11',
  };
}

function parseResult(result: CallToolResult): z.infer<typeof resultSchema> {
  invariant(result.content[0].type === 'text');
  return resultSchema.parse(JSON.parse(result.content[0].text));
}
