import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.desktop.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getListStoryboardsTool } from './listStoryboards.js';

describe('listStoryboardsTool', () => {
  const resultSchema = z.object({
    count: z.number(),
    storyboards: z.array(
      z.object({ id: z.string(), name: z.string(), index: z.number().nullish() }),
    ),
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getListStoryboardsTool(new DesktopMcpServer());
    expect(tool.name).toBe('list-storyboards');
    expect(tool.description).toContain('stable id');
    expect(tool.paramsSchema).toMatchObject({ session: expect.any(Object) });
    expect(tool.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
  });

  it('should list storyboards with their index and flags', async () => {
    const listStoryboards = vi.fn().mockResolvedValue(
      Ok({
        storyboards: [
          {
            id: 's1',
            name: 'Quarterly Story',
            type: 'STORYBOARD',
            hidden: false,
            isActiveSheet: true,
            index: 3,
            storyPointCount: 4,
          },
          {
            id: 's2',
            name: 'Hidden Story',
            type: 'STORYBOARD',
            hidden: true,
            isActiveSheet: false,
            index: null,
            storyPointCount: null,
          },
        ],
      }),
    );

    const result = await getToolResult({ session: '12345', listStoryboards });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const resultObj = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(resultObj.count).toBe(2);
    expect(resultObj.storyboards[0]).toMatchObject({ id: 's1', index: 3 });
    expect(resultObj.storyboards[1]).toMatchObject({ id: 's2', index: null });
    expect(listStoryboards).toHaveBeenCalledWith(expect.any(Object));
  });

  it('should return an empty list when the workbook has no storyboards', async () => {
    const result = await getToolResult({
      session: '12345',
      listStoryboards: vi.fn().mockResolvedValue(Ok({})),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(resultSchema.parse(JSON.parse(result.content[0].text))).toEqual({
      count: 0,
      storyboards: [],
    });
  });

  it('should return error when command execution fails', async () => {
    const error = { type: 'command-timed-out' as const, error: 'Timeout' };

    const result = await getToolResult({
      session: '12345',
      listStoryboards: vi.fn().mockResolvedValue(Err(error)),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new DesktopCommandExecutionError(error).message);
  });

  it('should pass the abort signal to the executor', async () => {
    const listStoryboards = vi.fn().mockResolvedValue(Ok({ storyboards: [] }));
    const customSignal = new AbortController().signal;

    await getToolResult({ session: '12345', listStoryboards, customSignal });

    expect(listStoryboards).toHaveBeenCalledWith(customSignal);
  });

  it('should reject a non-string session', () => {
    const tool = getListStoryboardsTool(new DesktopMcpServer());
    expect(z.object(tool.paramsSchema as z.ZodRawShape).safeParse({ session: 123 }).success).toBe(
      false,
    );
  });
});

async function getToolResult({
  session,
  listStoryboards,
  customSignal,
}: {
  session: string;
  listStoryboards: ReturnType<typeof vi.fn>;
  customSignal?: AbortSignal;
}): Promise<CallToolResult> {
  const tool = getListStoryboardsTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);

  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi
      .fn()
      .mockResolvedValue({ listStoryboards } as unknown as ExternalApiToolExecutor),
    ...(customSignal && { signal: customSignal }),
  };

  return await callback({ session }, extra);
}
