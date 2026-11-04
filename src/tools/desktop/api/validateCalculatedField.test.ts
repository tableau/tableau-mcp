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
import { getValidateCalculatedFieldTool } from './validateCalculatedField.js';

vi.mock('../../../desktop/session/sessionResolution.js');

describe('validate-calculated-field tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('declares a read-only datasource tool', () => {
    const tool = getValidateCalculatedFieldTool(new DesktopMcpServer());

    expect(tool.name).toBe('validate-calculated-field');
    expect(tool.minApiVersion).toBe('0.2.30');
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      datasourceName: expect.any(Object),
      formula: expect.any(Object),
      caption: expect.any(Object),
      fieldName: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('rejects an empty formula and an empty datasource name', () => {
    const tool = getValidateCalculatedFieldTool(new DesktopMcpServer());
    const schema = z.object(tool.paramsSchema as z.ZodRawShape);

    expect(schema.safeParse({ datasourceName: 'Superstore', formula: '' }).success).toBe(false);
    expect(schema.safeParse({ datasourceName: '', formula: 'SUM([Sales])' }).success).toBe(false);
    expect(
      schema.safeParse({ datasourceName: 'Superstore', formula: 'SUM([Sales])' }).success,
    ).toBe(true);
  });

  it('resolves the datasource name and posts the formula to its validate route', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({
        datasourceName: 'Sample - Superstore',
        formula: 'SUM([Sales])',
      });

      invariant(result.content[0].type === 'text');
      expect(result.isError).toBe(false);
      expect(JSON.parse(result.content[0].text)).toEqual({
        isValid: true,
        errors: [],
        dataType: 'real',
        isAggregate: true,
      });
      const post = harness.server.requests.find((request) => request.method === 'POST');
      expect(post?.path).toBe('/v0/workbook/datasources/wb-ds-superstore:validateCalculatedField');
      expect(JSON.parse(post?.body ?? '')).toEqual({ formula: 'SUM([Sales])' });
    } finally {
      await harness.close();
    }
  });

  it('sends caption and fieldName when given', async () => {
    const harness = await startHarness();
    try {
      await harness.callTool({
        datasourceName: 'wb-ds-superstore',
        formula: '[Sales] * 2',
        caption: 'Double Sales',
        fieldName: '[wb-ds-superstore].[Calc_1]',
      });

      const post = harness.server.requests.find((request) => request.method === 'POST');
      expect(JSON.parse(post?.body ?? '')).toEqual({
        formula: '[Sales] * 2',
        caption: 'Double Sales',
        fieldName: '[wb-ds-superstore].[Calc_1]',
      });
    } finally {
      await harness.close();
    }
  });

  it('qualifies a bare fieldName with the datasource internal name', async () => {
    const harness = await startHarness();
    try {
      await harness.callTool({
        datasourceName: 'Sample - Superstore',
        formula: '[Sales] * 2',
        fieldName: 'Calc_1',
      });

      const post = harness.server.requests.find((request) => request.method === 'POST');
      expect(JSON.parse(post?.body ?? '')).toEqual({
        formula: '[Sales] * 2',
        fieldName: '[Sample - Superstore].[Calc_1]',
      });
    } finally {
      await harness.close();
    }
  });

  it('returns validation errors as a successful result', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({
        datasourceName: 'Sample - Superstore',
        formula: 'SUM([Sales]',
      });

      invariant(result.content[0].type === 'text');
      expect(result.isError).toBe(false);
      expect(JSON.parse(result.content[0].text)).toMatchObject({
        isValid: false,
        errors: [{ position: 11, length: 0, message: 'Unbalanced parentheses.' }],
      });
    } finally {
      await harness.close();
    }
  });

  it('returns an error for an unknown datasource without validating', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ datasourceName: 'Missing', formula: 'SUM([Sales])' });

      expect(result.isError).toBe(true);
      expect(harness.server.requests.some((request) => request.method === 'POST')).toBe(false);
    } finally {
      await harness.close();
    }
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
  const tool = getValidateCalculatedFieldTool(new DesktopMcpServer());
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
    instanceId: 'inst-validate-calc',
    apiVersion: '0.2.31',
  };
}
