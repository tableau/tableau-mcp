import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { TableauDesktopToolContext } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getListStoryboardsTool } from './listStoryboards.js';

const routeMissing = {
  type: 'command-failed' as const,
  error: {
    code: 'not-found',
    message: 'No route matches GET /v0/workbook/storyboards',
    recoverable: false,
  },
};

describe('listStoryboardsTool', () => {
  const resultSchema = z.object({
    storyboards: z.array(z.object({ id: z.string().optional(), name: z.string() })),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getListStoryboardsTool(new DesktopMcpServer());
    expect(tool.name).toBe('list-storyboards');
    expect(tool.description).toContain('stable id');
    expect(tool.paramsSchema).toMatchObject({ session: expect.any(Object) });
    expect(tool.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
  });

  it('lists storyboards', async () => {
    const listStoryboards = vi.fn().mockResolvedValue(
      Ok({
        storyboards: [
          { id: 'story-1', name: 'QBR Story' },
          { id: 'story-2', name: 'Board Deck' },
        ],
      }),
    );

    const result = await getToolResult({ listStoryboards });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const resultObj = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(resultObj.storyboards).toEqual([
      { id: 'story-1', name: 'QBR Story' },
      { id: 'story-2', name: 'Board Deck' },
    ]);
  });

  it('projects a missing storyboards field to an empty list', async () => {
    const listStoryboards = vi.fn().mockResolvedValue(Ok({}));

    const result = await getToolResult({ listStoryboards });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const resultObj = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(resultObj.storyboards).toEqual([]);
  });

  it('maps a command-execution failure to DesktopCommandExecutionError', async () => {
    const error = { type: 'command-timed-out' as const, error: 'Timeout' };
    const listStoryboards = vi.fn().mockResolvedValue(Err(error));

    const result = await getToolResult({ listStoryboards });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new DesktopCommandExecutionError(error).message);
  });

  it('reports an honest too-new endpoint error when the storyboard list route is absent', async () => {
    const listStoryboards = vi.fn().mockResolvedValue(Err(routeMissing));

    const result = await getToolResult({ listStoryboards });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('does not serve the storyboard list endpoint');
    expect(result.content[0].text).toContain('Do not retry');
  });

  it('passes the abort signal to listStoryboards', async () => {
    const listStoryboards = vi
      .fn()
      .mockResolvedValue(Ok({ storyboards: [{ id: 'story-1', name: 'QBR Story' }] }));
    const customSignal = new AbortController().signal;

    await getToolResult({ listStoryboards, customSignal });

    expect(listStoryboards).toHaveBeenCalledWith(customSignal);
  });
});

// list-storyboards calls executor.listStoryboards directly through the read harness (no wrapper
// module to spy on), so drive it by injecting a fake executor via getExecutor.
async function getToolResult({
  listStoryboards,
  customSignal,
}: {
  listStoryboards: ReturnType<typeof vi.fn>;
  customSignal?: AbortSignal;
}): Promise<CallToolResult> {
  const tool = getListStoryboardsTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue({
      listStoryboards,
    }) as unknown as TableauDesktopToolContext['getExecutor'],
    ...(customSignal && { signal: customSignal }),
  };
  return await callback({ session: '12345' }, extra);
}
