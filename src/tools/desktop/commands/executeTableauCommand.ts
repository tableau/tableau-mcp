import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ArgsValidationError, DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().describe('Session ID from list-instances.'),
  command: z
    .string()
    .describe(
      "Full command name in format 'namespace:command' (e.g., 'tabdoc:save', 'tabdoc:delete-sheet'). Use search-commands to find available commands.",
    ),
  args: z
    .record(z.any())
    .optional()
    .describe("Command arguments as a JSON object (e.g., { 'Sheet': 'Sheet 1' })"),
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
      openWorldHint: false,
    },
    callback: async ({ session, command, args }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { session, command, args },
        callback: async () => {
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

          const executor = await extra.getExecutor(session);
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
