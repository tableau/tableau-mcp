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
    mocks.mockGetInstances.mockReturnValue(
      new Map([
        [
          77700,
          new DesktopInstance({
            pid: 77700,
            port: 8765,
            start_time,
            secret: '1234567890',
          }),
        ],
      ]),
    );
    const result = await getToolResult();
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const resultObj = z
      .object({
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
      })
      .parse(JSON.parse(result.content[0].text));

    expect(resultObj).toMatchObject({
      message: 'Found 1 running Tableau Desktop instances.',
      instances: [
        {
          sessionId: '77700',
          pid: 77700,
          port: 8765,
          start_time,
          secret_preview: '12345678...',
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
