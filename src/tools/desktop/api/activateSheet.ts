import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import {
  endpointNotInThisBuild,
  isRouteMissing,
  resolveItemByNameOrId,
} from '../../../desktop/externalApi/toolUtils.js';
import { resolveSession } from '../../../desktop/session/sessionResolution.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopCommandExecutionError, McpToolError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import {
  prefillNextAction,
  type WireStructuredContent,
  wireStructuredContent,
} from '../structuredContent.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
  sheetName: z.string().min(1).describe('Worksheet or dashboard name to make active.'),
};

// `focus_requested`, not `activated`: the goToSheet route settles asynchronously, so the
// tool knows it asked and does not know Tableau has repainted.
type ActivateSheetToolResult = {
  focus_requested: boolean;
  sheetName: string;
  message: string;
  availableSheets: string[];
};

class ActivateSheetNotFoundError extends McpToolError {
  readonly availableSheets: string[];
  readonly structuredContent: WireStructuredContent;

  constructor(sheetName: string, availableSheets: string[]) {
    const message = [
      `Sheet "${sheetName}" was not found in the live workbook worksheet/dashboard list.`,
      availableSheets.length > 0
        ? `Available sheets: ${availableSheets.map((name) => `"${name}"`).join(', ')}.`
        : 'The workbook has no activatable worksheets or dashboards.',
      'Use list-worksheets or list-dashboards to confirm the current names.',
    ].join(' ');
    super({
      type: 'sheet-not-found',
      statusCode: 404,
      message,
    });
    this.availableSheets = availableSheets;
    this.structuredContent = wireStructuredContent(
      { message, availableSheets },
      { nextAction: prefillNextAction('Choose an available sheet and retry') },
    );
  }
}

const title = 'Activate';
export const getActivateSheetTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const activateSheetTool = new DesktopTool({
    server,
    name: 'activate-sheet',
    title,
    description: 'Activate an existing worksheet or dashboard by exact name or id.',
    paramsSchema,
    annotations: {
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

          const resolved = await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) => {
              const worksheets = await read(
                'worksheet list',
                async (executor, signal) => await executor.listWorksheets(signal),
              );
              if (worksheets.isErr()) {
                return worksheets;
              }
              const dashboards = await read(
                'dashboard list',
                async (executor, signal) => await executor.listDashboards(signal),
              );
              if (dashboards.isErr()) {
                return dashboards;
              }

              const candidates = [
                ...(worksheets.value.worksheets ?? []),
                ...(dashboards.value.dashboards ?? []),
              ];
              const availableSheets = candidates.map((candidate) => candidate.name);
              const match = resolveItemByNameOrId('Sheet', sheetName, candidates);
              if (match.isErr()) {
                return new ActivateSheetNotFoundError(sheetName, availableSheets).toErr();
              }
              return new Ok({ id: match.value.id, name: match.value.name, availableSheets });
            },
          });
          if (resolved.isErr()) {
            return resolved.error.toErr();
          }

          const executor = await extra.getExecutor(sessionResult.value);
          const result = await executor.goToSheet(resolved.value.id, extra.signal);
          if (result.isErr()) {
            if (isRouteMissing(result.error)) {
              return endpointNotInThisBuild('activate-sheet').toErr();
            }
            return new DesktopCommandExecutionError(result.error).toErr();
          }

          return new Ok({
            focus_requested: true,
            sheetName: resolved.value.name,
            message:
              result.value.status === 'completed'
                ? `Requested focus on sheet "${resolved.value.name}".`
                : `Requested focus on sheet "${resolved.value.name}"; Desktop is still applying it.`,
            availableSheets: resolved.value.availableSheets,
          });
        },
      });
    },
  });

  return activateSheetTool;
};
