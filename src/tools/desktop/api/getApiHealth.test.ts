import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { makeExecutorMock } from '../../../desktop/externalApi/executor.mock.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getApiHealthTool } from './getApiHealth.js';

vi.mock('../../../desktop/session/sessionResolution.js');

describe('get-api-health tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('declares the read contract', () => {
    const tool = getApiHealthTool(new DesktopMcpServer());

    expect(tool.name).toBe('get-api-health');
    expect(tool.paramsSchema).toMatchObject({ session: expect.any(Object) });
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('resolves the session and forwards the request signal', async () => {
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
    const health = vi.fn().mockResolvedValue(Ok({ healthy: true }));
    const controller = new AbortController();
    const extra = {
      ...getMockRequestHandlerExtra(),
      signal: controller.signal,
      getExecutor: vi.fn().mockResolvedValue(makeExecutorMock({ health })),
    };

    const result = await invokeTool({ session: undefined }, extra);

    expect(parseResult(result)).toEqual({ healthy: true });
    expect(sessionResolution.resolveSession).toHaveBeenCalledWith(undefined);
    expect(extra.getExecutor).toHaveBeenCalledWith('999');
    expect(health).toHaveBeenCalledExactlyOnceWith(controller.signal);
  });

  it('reports an unhealthy API as a result', async () => {
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi
        .fn()
        .mockResolvedValue(
          makeExecutorMock({ health: vi.fn().mockResolvedValue(Ok({ healthy: false })) }),
        ),
    };

    expect(parseResult(await invokeTool({ session: '999' }, extra))).toEqual({ healthy: false });
  });

  it('returns an error result when the executor fails', async () => {
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue(
        makeExecutorMock({
          health: vi.fn().mockResolvedValue(
            Err({
              type: 'command-failed' as const,
              error: { code: 'api-disabled', message: 'API is disabled', recoverable: false },
            }),
          ),
        }),
      ),
    };

    const result = await invokeTool({ session: undefined }, extra);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('API is disabled');
  });

  it('rejects a non-string session', () => {
    const tool = getApiHealthTool(new DesktopMcpServer());

    const { session } = tool.paramsSchema as z.ZodRawShape;

    expect(session.safeParse(42).success).toBe(false);
    expect(session.safeParse(undefined).success).toBe(true);
    expect(session.safeParse('999').success).toBe(true);
  });
});

async function invokeTool(
  args: { session: string | undefined },
  extra: ReturnType<typeof getMockRequestHandlerExtra>,
): Promise<CallToolResult> {
  const tool = getApiHealthTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(args, extra);
}

function parseResult(result: CallToolResult): { healthy: boolean } {
  expect(result.isError).toBe(false);
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text) as { healthy: boolean };
}
