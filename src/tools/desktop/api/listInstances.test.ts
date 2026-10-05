import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { NoDesktopInstancesFoundError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getListInstancesTool } from './listInstances.js';

const mocks = vi.hoisted(() => ({
  discoverInstances: vi.fn(),
}));

vi.mock('../../../desktop/externalApi/discovery.js', () => ({
  discoverInstances: mocks.discoverInstances,
}));

describe('listInstancesTool', () => {
  const resultSchema = z.object({
    message: z.string(),
    instances: z.array(
      z.object({
        sessionId: z.string(),
        pid: z.number(),
        baseUrl: z.string(),
        apiVersion: z.string().optional(),
        hasToken: z.boolean(),
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
    mocks.discoverInstances.mockReturnValue([]);
    const result = await getToolResult();
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new NoDesktopInstancesFoundError().message);
  });

  it('should successfully list instances', async () => {
    mocks.discoverInstances.mockReturnValue([
      {
        pid: 77700,
        baseUrl: 'http://127.0.0.1:8765',
        token: '1234567890',
        instanceId: 'a',
        apiVersion: '1.0',
      },
      {
        pid: 26928,
        baseUrl: 'http://127.0.0.1:8766',
        token: '1223334444',
        instanceId: 'b',
      },
    ]);
    const result = await getToolResult();
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const resultObj = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(resultObj).toMatchObject({
      message: 'Found 2 running Tableau Desktop instances (External Client API).',
      instances: [
        {
          sessionId: '77700',
          pid: 77700,
          baseUrl: 'http://127.0.0.1:8765',
          apiVersion: '1.0',
          hasToken: true,
        },
        {
          sessionId: '26928',
          pid: 26928,
          baseUrl: 'http://127.0.0.1:8766',
          hasToken: true,
        },
      ],
      instructions:
        'Use the session ID of the instance you want to use in the session parameter of other tools.',
    });
  });

  it('should report token presence without exposing the token', async () => {
    mocks.discoverInstances.mockReturnValue([
      {
        pid: 77700,
        baseUrl: 'http://127.0.0.1:8765',
        token: '',
        instanceId: 'a',
      },
    ]);
    const result = await getToolResult();
    invariant(result.content[0].type === 'text');

    const resultObj = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(resultObj).toMatchObject({
      message: 'Found 1 running Tableau Desktop instance (External Client API).',
      instances: [
        {
          sessionId: '77700',
          pid: 77700,
          baseUrl: 'http://127.0.0.1:8765',
          hasToken: false,
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
