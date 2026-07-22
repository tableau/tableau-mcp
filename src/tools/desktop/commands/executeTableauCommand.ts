import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { knownLiveFailureFixFor } from '../../../desktop/commandPolicy.js';
import { guardCommand } from '../../../desktop/commands/externalApiCommandGuard.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import type { ExecuteCommandWarning } from '../../../desktop/toolExecutor/toolExecutor.js';
import { ArgsValidationError, DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const MAX_RESULT_BYTES = 16 * 1024;

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  command: z.string().describe('namespace:command; use search-commands.'),
  args: z.record(z.any()).optional().describe('JSON command args.'),
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
      'Execute a registered Tableau Desktop command. Use search-commands first; format namespace:command.',
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

          const commandGuard = guardCommand({ namespace, cmd, command, args });
          if ('refused' in commandGuard) {
            return new ArgsValidationError(commandGuard.message).toErr();
          }
          const { dispatchArgs, warnings: commandGuardWarnings } = commandGuard;

          const executor = await extra.getExecutor(resolvedSession);
          const result = await executor.executeCommand({
            namespace,
            command: cmd,
            args: dispatchArgs,
            signal: extra.signal,
          });

          if (result.isErr()) {
            return new DesktopCommandExecutionError(
              result.error,
              knownLiveFailureFixFor(command),
            ).toErr();
          }

          const payload = shapeCommandResult({
            result: result.value.result,
            envelopeWarnings: result.value.warnings ?? [],
            guardWarnings: commandGuardWarnings,
          });

          return new Ok(payload);
        },
        getSuccessResult: (payload): CallToolResult => ({
          isError: hasOutputSerializationFailed(payload),
          content: [{ type: 'text', text: JSON.stringify(payload) }],
        }),
      });
    },
  });

  return tool;
};

type ExecuteTableauCommandSuccess = {
  message: string;
  result?: Record<string, unknown> | string;
  warnings?: ExecuteCommandWarning[];
};

function shapeCommandResult({
  result,
  envelopeWarnings,
  guardWarnings,
}: {
  result: Record<string, unknown> | null | undefined;
  envelopeWarnings: ExecuteCommandWarning[];
  guardWarnings: string[];
}): ExecuteTableauCommandSuccess {
  const outputSerializationFailed = envelopeWarnings.some(
    (warning) => warning.code === 'output-serialization-failed',
  );
  const payload: ExecuteTableauCommandSuccess = {
    message: outputSerializationFailed
      ? 'Command executed, but the requested result cannot be returned because Desktop reported output serialization failed.'
      : 'Command executed successfully.',
  };

  if (result !== undefined && result !== null) {
    const serialized = JSON.stringify(result, null, 2);
    const totalBytes = Buffer.byteLength(serialized, 'utf-8');
    if (totalBytes > MAX_RESULT_BYTES) {
      const preview = Buffer.from(serialized, 'utf-8').subarray(0, MAX_RESULT_BYTES).toString();
      const previewBytes = Buffer.byteLength(preview, 'utf-8');
      payload.result = `${preview}\n...`;
      payload.message =
        `Command executed successfully. result truncated: ${previewBytes} of ${totalBytes} bytes - ` +
        're-run with a narrower command if you need the rest.';
    } else {
      payload.result = result;
    }
  }

  const warningLines = [
    ...envelopeWarnings.map((warning) => `WARNING: ${warning.code} - ${warning.message}`),
    ...guardWarnings,
  ];
  if (warningLines.length > 0) {
    payload.message = `${payload.message}\n\n${warningLines.join('\n')}`;
  }
  if (envelopeWarnings.length > 0) {
    payload.warnings = envelopeWarnings;
  }

  return payload;
}

function hasOutputSerializationFailed(payload: ExecuteTableauCommandSuccess): boolean {
  return (
    payload.warnings?.some((warning) => warning.code === 'output-serialization-failed') ?? false
  );
}
