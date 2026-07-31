import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import {
  ExecuteCommandError,
  ExecuteCommandResult,
} from '../../../desktop/toolExecutor/toolExecutor.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

type CommandRun = (
  executor: ExternalApiToolExecutor,
  signal: AbortSignal,
) => Promise<Result<ExecuteCommandResult<undefined>, ExecuteCommandError>>;

const COMMANDS: Record<string, CommandRun> = {
  undo: (executor, signal) => executor.undo(signal),
  redo: (executor, signal) => executor.redo(signal),
};

const commands = Object.keys(COMMANDS) as [string, ...string[]];

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  command: z.enum(commands),
};

const title = 'Run Tableau Command';
export const getDesktopCommandTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const desktopCommand = new DesktopTool({
    server,
    name: 'desktop-command',
    title,
    description: 'Undo or redo the last workbook change.',
    paramsSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async ({ session, command }, extra): Promise<CallToolResult> => {
      return await desktopCommand.logAndExecute({
        extra,
        args: { session, command },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const executor = await extra.getExecutor(sessionResult.value);

          const result = await COMMANDS[command](executor, extra.signal);
          if (result.isErr()) {
            return new DesktopCommandExecutionError(result.error).toErr();
          }

          return new Ok({ command, status: result.value.status });
        },
      });
    },
  });

  return desktopCommand;
};
