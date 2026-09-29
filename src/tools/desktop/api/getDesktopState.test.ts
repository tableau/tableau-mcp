import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { makeExecutorMock } from '../../../desktop/externalApi/executor.mock.js';
import { DesktopState } from '../../../desktop/externalApi/types.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getDesktopStateTool } from './getDesktopState.js';

vi.mock('../../../desktop/session/sessionResolution.js');

describe('get-desktop-state tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('declares the read contract and 0.2.14 API floor', () => {
    const tool = getDesktopStateTool(new DesktopMcpServer());

    expect(tool.name).toBe('get-desktop-state');
    expect(tool.minApiVersion).toBe('0.2.14');
    expect(tool.description).toContain('strongest observed blocking cause');
    expect(tool.description).toContain('fresh exact identity and actions from get-active-dialogs');
    expect(tool.paramsSchema).toMatchObject({ session: expect.any(Object) });
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('uses canonical session resolution and forwards the request signal', async () => {
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
    const state: DesktopState = {
      state: 'IDLE',
      uiSnapshotAvailable: true,
      activeActivities: [],
      blockingWindows: [],
      progressWindows: [],
    };
    const getDesktopState = vi.fn().mockResolvedValue(Ok(state));
    const executor = makeExecutorMock({ getDesktopState });
    const controller = new AbortController();
    const extra = {
      ...getMockRequestHandlerExtra(),
      signal: controller.signal,
      getExecutor: vi.fn().mockResolvedValue(executor),
    };

    const result = await invokeTool({ session: undefined }, extra);

    expect(parseResult(result)).toEqual(state);
    expect(sessionResolution.resolveSession).toHaveBeenCalledWith(undefined);
    expect(extra.getExecutor).toHaveBeenCalledWith('999');
    expect(getDesktopState).toHaveBeenCalledExactlyOnceWith(controller.signal);
  });

  it('relays shared dialog context and future fields unchanged', async () => {
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
    const state = {
      state: 'BLOCKED',
      blockedBy: 'MODAL_DIALOG',
      uiSnapshotAvailable: true,
      activeActivities: ['QUERYING', 'FUTURE_ACTIVITY'],
      blockingWindows: [
        {
          objectName: 'connectionError',
          title: 'Connection failed',
          className: 'QMessageBox',
          detailedTextTruncated: true,
          actions: [{ kind: 'button' as const, label: 'Retry' }, { kind: 'close' as const }],
          futureWindowField: { native: true },
        },
      ],
      progressWindows: [],
      futureEnvelopeField: ['preserved'],
    };
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi
        .fn()
        .mockResolvedValue(
          makeExecutorMock({ getDesktopState: vi.fn().mockResolvedValue(Ok(state)) }),
        ),
    };

    expect(parseResult(await invokeTool({ session: '999' }, extra))).toEqual(state);
  });

  it('maps a stable 404 to the endpoint-unavailable read error', async () => {
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue(
        makeExecutorMock({
          getDesktopState: vi.fn().mockResolvedValue(
            Err({
              type: 'command-failed' as const,
              error: {
                code: 'not-found',
                message: 'No route matches GET /v0/app/state',
                recoverable: false,
              },
            }),
          ),
        }),
      ),
    };

    const result = await invokeTool({ session: undefined }, extra);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Desktop state endpoint');
    expect(result.content[0].text).toContain('too old for this read');
    expect(result.content[0].text).toContain('Do not retry');
  });
});

async function invokeTool(
  args: { session: string | undefined },
  extra: ReturnType<typeof getMockRequestHandlerExtra>,
): Promise<CallToolResult> {
  const tool = getDesktopStateTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(args, extra);
}

function parseResult(result: CallToolResult): DesktopState {
  expect(result.isError).toBe(false);
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text) as DesktopState;
}
