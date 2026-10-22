import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { makeExecutorMock } from '../../../desktop/externalApi/executor.mock.js';
import { ApiRoot } from '../../../desktop/externalApi/types.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getApiRootTool } from './getApiRoot.js';

vi.mock('../../../desktop/session/sessionResolution.js');

describe('get-api-root tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('declares the read contract', () => {
    const tool = getApiRootTool(new DesktopMcpServer());

    expect(tool.name).toBe('get-api-root');
    expect(tool.paramsSchema).toMatchObject({ session: expect.any(Object) });
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('returns the root document and forwards the request signal', async () => {
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
    const root: ApiRoot = {
      apiVersion: '0.2.25',
      applicationVersion: '2026.3.0',
      links: { app: '/v0/app' },
    };
    const getRoot = vi.fn().mockResolvedValue(Ok(root));
    const controller = new AbortController();
    const extra = {
      ...getMockRequestHandlerExtra(),
      signal: controller.signal,
      getExecutor: vi.fn().mockResolvedValue(makeExecutorMock({ getRoot })),
    };

    const result = await invokeTool({ session: undefined }, extra);

    expect(parseResult(result)).toEqual(root);
    expect(sessionResolution.resolveSession).toHaveBeenCalledWith(undefined);
    expect(extra.getExecutor).toHaveBeenCalledWith('999');
    expect(getRoot).toHaveBeenCalledExactlyOnceWith(controller.signal);
  });

  it('reports an executor error', async () => {
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue(
        makeExecutorMock({
          getRoot: vi.fn().mockResolvedValue(
            Err({
              type: 'command-failed' as const,
              error: { code: 'internal-error', message: 'Root unavailable', recoverable: false },
            }),
          ),
        }),
      ),
    };

    const result = await invokeTool({ session: '999' }, extra);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Root unavailable');
  });

  it('accepts an optional string session and rejects other types', () => {
    const schema = z.object(getApiRootTool(new DesktopMcpServer()).paramsSchema as z.ZodRawShape);

    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ session: '999' }).success).toBe(true);
    expect(schema.safeParse({ session: { id: 1 } }).success).toBe(false);
  });
});

async function invokeTool(
  args: { session: string | undefined },
  extra: ReturnType<typeof getMockRequestHandlerExtra>,
): Promise<CallToolResult> {
  const tool = getApiRootTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(args, extra);
}

function parseResult(result: CallToolResult): ApiRoot {
  expect(result.isError).toBe(false);
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text) as ApiRoot;
}
