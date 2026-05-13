import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { DesktopInstance } from '../../../desktop/desktopInstance.js';
import { NoDesktopInstancesFoundError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getListInstancesTool } from './listInstances.js';

const mocks = vi.hoisted(() => ({
  mockGetInstances: vi.fn(),
}));

vi.mock('../../../desktop/desktopDiscoverer.js', () => ({
  DesktopDiscoverer: vi.fn().mockImplementation(() => ({
    getInstances: mocks.mockGetInstances,
  })),
}));

describe('listInstancesTool', () => {
  const resultSchema = z.object({
    message: z.string(),
    instances: z.array(
      z.object({
        sessionId: z.string(),
        pid: z.number(),
        port: z.number(),
        start_time: z.string(),
        secret_preview: z.string().nullable(),
      }),
    ),
    instructions: z.string(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const listInstancesTool = getListInstancesTool(new DesktopMcpServer());
    expect(listInstancesTool.name).toBe('list-instances');
    expect(listInstancesTool.description).toContain('List all running Tableau Desktop instances');
    expect(listInstancesTool.paramsSchema).toMatchObject({});
  });

  it('should return an error when no instances are found', async () => {
    mocks.mockGetInstances.mockReturnValue(new Map());
    const result = await getToolResult();
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new NoDesktopInstancesFoundError().message);
  });

  it('should successfully list instances', async () => {
    const start_time = new Date().toISOString();
    const start_time2 = new Date().toISOString();
    mocks.mockGetInstances.mockReturnValue(
      new Map([
        [77700, new DesktopInstance({ pid: 77700, port: 8765, start_time, secret: '1234567890' })],
        [
          26928,
          new DesktopInstance({
            pid: 26928,
            port: 8766,
            start_time: start_time2,
            secret: '1223334444',
          }),
        ],
      ]),
    );
    const result = await getToolResult();
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const resultObj = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(resultObj).toMatchObject({
      message: 'Found 2 running Tableau Desktop instances.',
      instances: [
        {
          sessionId: '77700',
          pid: 77700,
          port: 8765,
          start_time,
          secret_preview: '12345678...',
        },
        {
          sessionId: '26928',
          pid: 26928,
          port: 8766,
          start_time: start_time2,
          secret_preview: '12233344...',
        },
      ],
      instructions:
        'Use the session ID of the instance you want to use in the session parameter of other tools.',
    });
  });

  it('should not return a secret preview when secret is not set', async () => {
    const start_time = new Date().toISOString();
    mocks.mockGetInstances.mockReturnValue(
      new Map([[77700, new DesktopInstance({ pid: 77700, port: 8765, start_time, secret: '' })]]),
    );
    const result = await getToolResult();
    invariant(result.content[0].type === 'text');

    const resultObj = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(resultObj).toMatchObject({
      message: 'Found 1 running Tableau Desktop instance.',
      instances: [
        {
          sessionId: '77700',
          pid: 77700,
          port: 8765,
          start_time,
          secret_preview: null,
        },
      ],
      instructions:
        'Use the session ID of the instance you want to use in the session parameter of other tools.',
    });
  });
});

async function getToolResult(): Promise<CallToolResult> {
  const listInstancesTool = getListInstancesTool(new DesktopMcpServer());
  const callback = await Provider.from(listInstancesTool.callback);
  return await callback({}, getMockRequestHandlerExtra());
}
