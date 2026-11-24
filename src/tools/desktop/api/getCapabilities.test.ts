import { CallToolResult } from '@modelcontextprotocol/server';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { makeExecutorMock } from '../../../desktop/externalApi/executor.mock.js';
import { CapabilityMatrix } from '../../../desktop/externalApi/types.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getCapabilitiesTool } from './getCapabilities.js';

vi.mock('../../../desktop/session/sessionResolution.js');

describe('get-capabilities tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('declares the read contract', () => {
    const tool = getCapabilitiesTool(new DesktopMcpServer());

    expect(tool.name).toBe('get-capabilities');
    expect(tool.description).toContain('requiresServer');
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
    const matrix: CapabilityMatrix = {
      capabilities: {
        getApp: { requiresServer: false },
        openFile: { requiresServer: true },
      },
    };
    const getCapabilities = vi.fn().mockResolvedValue(Ok(matrix));
    const controller = new AbortController();
    const extra = {
      ...getMockRequestHandlerExtra(),
      signal: controller.signal,
      getExecutor: vi.fn().mockResolvedValue(makeExecutorMock({ getCapabilities })),
    };

    const result = await invokeTool({ session: undefined }, extra);

    expect(parseResult(result)).toEqual(matrix);
    expect(sessionResolution.resolveSession).toHaveBeenCalledWith(undefined);
    expect(extra.getExecutor).toHaveBeenCalledWith('999');
    expect(getCapabilities).toHaveBeenCalledExactlyOnceWith(controller.signal);
  });

  it('rejects a non-string session', () => {
    const tool = getCapabilitiesTool(new DesktopMcpServer());

    const { session } = tool.paramsSchema as z.ZodRawShape;

    expect(z.safeParse(session, 123).success).toBe(false);
    expect(z.safeParse(session, undefined).success).toBe(true);
  });
});

async function invokeTool(
  args: { session: string | undefined },
  extra: ReturnType<typeof getMockRequestHandlerExtra>,
): Promise<CallToolResult> {
  const tool = getCapabilitiesTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(args, extra);
}

function parseResult(result: CallToolResult): CapabilityMatrix {
  expect(result.isError).toBe(false);
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text) as CapabilityMatrix;
}
