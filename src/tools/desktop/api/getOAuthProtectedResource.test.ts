import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { makeExecutorMock } from '../../../desktop/externalApi/executor.mock.js';
import { ProtectedResourceMetadata } from '../../../desktop/externalApi/types.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getOAuthProtectedResourceTool } from './getOAuthProtectedResource.js';

vi.mock('../../../desktop/session/sessionResolution.js');

describe('get-oauth-protected-resource tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('declares the read contract and session parameter', () => {
    const tool = getOAuthProtectedResourceTool(new DesktopMcpServer());

    expect(tool.name).toBe('get-oauth-protected-resource');
    expect(tool.description).toContain('RFC 9728');
    expect(tool.paramsSchema).toMatchObject({ session: expect.any(Object) });
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('returns the metadata and forwards the request signal', async () => {
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
    const metadata: ProtectedResourceMetadata = {
      resource: 'http://127.0.0.1:1234',
      bearer_methods_supported: ['header'],
    };
    const getOAuthProtectedResource = vi.fn().mockResolvedValue(Ok(metadata));
    const controller = new AbortController();
    const extra = {
      ...getMockRequestHandlerExtra(),
      signal: controller.signal,
      getExecutor: vi.fn().mockResolvedValue(makeExecutorMock({ getOAuthProtectedResource })),
    };

    const result = await invokeTool({ session: undefined }, extra);

    expect(parseResult(result)).toEqual(metadata);
    expect(sessionResolution.resolveSession).toHaveBeenCalledWith(undefined);
    expect(extra.getExecutor).toHaveBeenCalledWith('999');
    expect(getOAuthProtectedResource).toHaveBeenCalledExactlyOnceWith(controller.signal);
  });

  it('reports an executor error', async () => {
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue(
        makeExecutorMock({
          getOAuthProtectedResource: vi.fn().mockResolvedValue(
            Err({
              type: 'command-failed' as const,
              error: { code: 'internal-error', message: 'Desktop failed', recoverable: false },
            }),
          ),
        }),
      ),
    };

    const result = await invokeTool({ session: undefined }, extra);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Desktop failed');
  });

  it('rejects a non-string session', () => {
    const tool = getOAuthProtectedResourceTool(new DesktopMcpServer());
    const schema = (tool.paramsSchema as z.ZodRawShape).session;

    expect(schema.safeParse(123).success).toBe(false);
    expect(schema.safeParse('999').success).toBe(true);
  });
});

async function invokeTool(
  args: { session: string | undefined },
  extra: ReturnType<typeof getMockRequestHandlerExtra>,
): Promise<CallToolResult> {
  const tool = getOAuthProtectedResourceTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(args, extra);
}

function parseResult(result: CallToolResult): ProtectedResourceMetadata {
  expect(result.isError).toBe(false);
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text) as ProtectedResourceMetadata;
}
