import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { validateKnownCommand } from '../../../desktop/commandRegistry.js';
import { validateNotionalSpecArgs } from '../../../desktop/notionalSpecGuard.js';
import { validateCommandParams } from '../../../desktop/paramContractGuard.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { ArgsValidationError, DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  command: z
    .string()
    .describe(
      "Command name: 'namespace:command' (e.g., 'tabdoc:save', 'tabdoc:delete-sheet'). Use search-commands.",
    ),
  args: z.record(z.any()).optional().describe("JSON command args (e.g., { 'Sheet': 'Sheet 1' })."),
};

const title = 'Execute Tableau Command';
export const getExecuteTableauCommandTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'execute-tableau-command',
    title,
    description:
      "Execute an arbitrary registered Tableau Desktop command. Use search-commands to find available commands; a name not in the registry returns command-not-found. Commands use the format 'namespace:command' (e.g., 'tabdoc:save', 'tabdoc:delete-sheet').",
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async ({ session, command, args }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { session, command, args },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;

          const parts = command.split(':');
          if (parts.length !== 2) {
            return new ArgsValidationError(
              `Invalid command format. Expected 'namespace:command' (e.g., 'tabdoc:goto-sheet'), got: ${command}`,
            ).toErr();
          }

          const [namespace, cmd] = parts as ['tabui' | 'tabdoc', string];
          if (namespace !== 'tabui' && namespace !== 'tabdoc') {
            return new ArgsValidationError(
              `Invalid namespace "${namespace}". Expected 'tabui' or 'tabdoc'.`,
            ).toErr();
          }

          const commandValidation = validateKnownCommand(command);
          if (!commandValidation.ok) {
            return new ArgsValidationError(commandValidation.message).toErr();
          }

          // Generic param-contract guard: runs after the verb is confirmed known,
          // before the deeper NotionalSpec payload guard. Fails open on commands
          // with zero declared "in" params so the two never contradict.
          const paramValidation = validateCommandParams(command, args);
          if (!paramValidation.ok) {
            return new ArgsValidationError(paramValidation.message).toErr();
          }

          const notionalSpecValidation = validateNotionalSpecArgs(command, args);
          if (!notionalSpecValidation.ok) {
            return new ArgsValidationError(notionalSpecValidation.message).toErr();
          }

          const executor = await extra.getExecutor(resolvedSession);
          const result = await executor.executeCommand({
            namespace,
            command: cmd,
            args: args ?? {},
            signal: extra.signal,
          });

          if (result.isErr()) {
            return new DesktopCommandExecutionError(result.error).toErr();
          }

          const resultText = result.value.result
            ? JSON.stringify(result.value.result, null, 2)
            : 'Command completed successfully (no result data)';

          return new Ok({
            message: `Command executed successfully:\n\n${resultText}`,
          });
        },
      });
    },
  });

  return tool;
};
