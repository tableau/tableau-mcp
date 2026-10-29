import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { makeExecutorMock } from '../../../desktop/externalApi/executor.mock.js';
import { AppInfo } from '../../../desktop/externalApi/types.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getAppInfoTool } from './getAppInfo.js';

vi.mock('../../../desktop/session/sessionResolution.js');

describe('get-app-info tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('declares the read contract', () => {
    const tool = getAppInfoTool(new DesktopMcpServer());

    expect(tool.name).toBe('get-app-info');
    expect(tool.description).toContain('get-desktop-state');
    expect(tool.paramsSchema).toMatchObject({ session: expect.any(Object) });
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('accepts an optional string session and rejects other types', () => {
    const schema = z.object(getAppInfoTool(new DesktopMcpServer()).paramsSchema as z.ZodRawShape);

    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ session: '999' }).success).toBe(true);
    expect(schema.safeParse({ session: 999 }).success).toBe(false);
  });

  it('returns every app info field including unknown ones and forwards the signal', async () => {
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
    const info = {
      applicationVersion: '2026.2.0',
      edition: 'Desktop',
      build: '20262.26.0101.1234',
      os: 'macOS',
      locale: 'en_US',
      repositoryLocation: '/Users/me/Documents/My Tableau Repository',
      logLocation: '/Users/me/Documents/My Tableau Repository/Logs',
      isStartPageVisible: false,
      isDataSourcePageActive: true,
      isPresentationMode: false,
      isCanvasMode: true,
      futureField: 'preserved',
    } satisfies AppInfo;
    const getApp = vi.fn().mockResolvedValue(Ok(info));
    const controller = new AbortController();
    const extra = {
      ...getMockRequestHandlerExtra(),
      signal: controller.signal,
      getExecutor: vi.fn().mockResolvedValue(makeExecutorMock({ getApp })),
    };

    const result = await invokeTool({ session: undefined }, extra);

    expect(parseResult(result)).toEqual(info);
    expect(sessionResolution.resolveSession).toHaveBeenCalledWith(undefined);
    expect(extra.getExecutor).toHaveBeenCalledWith('999');
    expect(getApp).toHaveBeenCalledExactlyOnceWith(controller.signal);
  });

  it('reports an executor error', async () => {
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue(
        makeExecutorMock({
          getApp: vi.fn().mockResolvedValue(
            Err({
              type: 'command-failed' as const,
              error: { code: 'internal-error', message: 'App info failed', recoverable: false },
            }),
          ),
        }),
      ),
    };

    const result = await invokeTool({ session: undefined }, extra);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('App info failed');
  });
});

async function invokeTool(
  args: { session: string | undefined },
  extra: ReturnType<typeof getMockRequestHandlerExtra>,
): Promise<CallToolResult> {
  const tool = getAppInfoTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(args, extra);
}

function parseResult(result: CallToolResult): AppInfo {
  expect(result.isError).toBe(false);
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text) as AppInfo;
}
