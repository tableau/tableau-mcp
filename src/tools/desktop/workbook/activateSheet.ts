import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { activateSheetWithValidatedGoto } from '../../../desktop/commands/workbook/activateSheet.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import {
  DesktopCommandExecutionError,
  McpToolError,
  XmlModificationError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

export { activateSheetWithValidatedGoto };

const paramsSchema = {
  session: z.string().optional().describe('Optional Tableau Desktop session id.'),
  sheetName: z.string().min(1).describe('Worksheet or dashboard name to make active.'),
};

type ActivateSheetToolResult = {
  activated: true;
  sheetName: string;
  message: string;
  previousSheet?: string;
  availableSheets: string[];
};

class ActivateSheetNotFoundError extends McpToolError {
  readonly availableSheets: string[];
  readonly structuredContent: { readonly availableSheets: string[] };

  constructor(sheetName: string, availableSheets: string[]) {
    super({
      type: 'sheet-not-found',
      statusCode: 404,
      message: [
        `Sheet "${sheetName}" was not found in the live workbook worksheet/dashboard list.`,
        availableSheets.length > 0
          ? `Available sheets: ${availableSheets.map((name) => `"${name}"`).join(', ')}.`
          : 'The workbook has no activatable worksheets or dashboards.',
        'Use list-worksheets or list-dashboards to confirm the current names.',
      ].join(' '),
    });
    this.availableSheets = availableSheets;
    this.structuredContent = { availableSheets };
  }
}

const title = 'Activate';
export const getActivateSheetTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const activateSheetTool = new DesktopTool({
    server,
    name: 'activate-sheet',
    description:
      'Activate an existing worksheet or dashboard by exact name after validating it against a fresh live-workbook read.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    callback: async ({ session, sheetName }, extra): Promise<CallToolResult> => {
      return await activateSheetTool.logAndExecute<ActivateSheetToolResult>({
        extra,
        args: { session, sheetName },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;
          const executor = await extra.getExecutor(resolvedSession);

          const activation = await activateSheetWithValidatedGoto({
            sheetName,
            executor,
            signal: extra.signal,
          });
          switch (activation.status) {
            case 'read-failed':
            case 'command-failed':
              return new DesktopCommandExecutionError(activation.error).toErr();
            case 'parse-failed':
              return new XmlModificationError(
                `Could not inspect the live workbook before activation: ${activation.message}`,
              ).toErr();
            case 'not-found':
              return new ActivateSheetNotFoundError(sheetName, activation.availableSheets).toErr();
            case 'activated':
              return new Ok({
                activated: true,
                sheetName,
                message: `Activated sheet "${sheetName}".`,
                ...(activation.previousSheet ? { previousSheet: activation.previousSheet } : {}),
                availableSheets: activation.availableSheets,
              });
          }
        },
      });
    },
  });

  return activateSheetTool;
};
