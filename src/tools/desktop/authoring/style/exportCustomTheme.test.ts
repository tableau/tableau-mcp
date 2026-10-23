import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { makeExecutorMock } from '../../../../desktop/externalApi/executor.mock.js';
import type { ExternalApiToolExecutor } from '../../../../desktop/externalApi/externalApiToolExecutor.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getExportCustomThemeTool } from './exportCustomTheme.js';

describe('export-custom-theme', () => {
  it('maps only the native Export Custom Theme dialog to a manual save handoff', async () => {
    const executor = makeExecutorMock({
      executeCommand: vi.fn().mockResolvedValue(
        Err({
          type: 'command-failed' as const,
          error: {
            code: 'awaiting-user',
            message: 'Open dialog(s): "Export Custom Theme".',
            recoverable: false,
          },
        }),
      ),
    });

    const result = await callTool(executor);

    expect(result.isError).toBe(false);
    expect(bodyOf(result)).toEqual({
      started: true,
      requiresUserAction: true,
      action: 'Save the Custom Theme JSON in Tableau, then attach it in Studio.',
    });
    expect(executor.executeCommand).toHaveBeenCalledOnce();
    expect(executor.executeCommand).toHaveBeenCalledWith({
      namespace: 'tabui',
      command: 'export-theme',
      expectedInstanceId: 'instance-live',
      signal: expect.any(AbortSignal),
    });
  });

  it.each([
    [
      'a different blocking dialog',
      {
        type: 'command-failed' as const,
        error: {
          code: 'awaiting-user',
          message: 'Open dialog(s): "Save Workbook".',
          recoverable: false,
        },
      },
    ],
    [
      'a normal command failure',
      {
        type: 'command-failed' as const,
        error: { code: 'failed', message: 'Export failed', recoverable: false },
      },
    ],
  ])('keeps %s as an error and never retries', async (_case, error) => {
    const executor = makeExecutorMock({ executeCommand: vi.fn().mockResolvedValue(Err(error)) });

    const result = await callTool(executor);

    expect(result.isError).toBe(true);
    expect(executor.executeCommand).toHaveBeenCalledOnce();
  });

  it('reports a command that completes without a dialog as completed', async () => {
    const executor = makeExecutorMock({
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'export-theme-1',
          status: 'completed' as const,
          submitted_at: 'now',
        }),
      ),
    });

    const result = await callTool(executor);

    expect(bodyOf(result)).toEqual({
      started: true,
      requiresUserAction: false,
      action: 'Tableau completed the Custom Theme export command.',
    });
  });
});

async function callTool(executor: ExternalApiToolExecutor): Promise<CallToolResult> {
  (executor as unknown as { desktopInstanceId: string | undefined }).desktopInstanceId =
    'instance-live';
  const callback = await Provider.from(getExportCustomThemeTool(new DesktopMcpServer()).callback);
  return await callback(
    { session: 'S1' },
    { ...getMockRequestHandlerExtra(), getExecutor: vi.fn().mockResolvedValue(executor) },
  );
}

function bodyOf(result: CallToolResult): Record<string, unknown> {
  invariant(result.content[0]?.type === 'text');
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}
