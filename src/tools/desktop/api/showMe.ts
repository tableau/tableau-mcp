import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import {
  endpointNotInThisBuild,
  isRouteMissing,
  resolveItemByNameOrId,
} from '../../../desktop/externalApi/toolUtils.js';
import { SHOW_ME_TYPES, WorksheetShowMeRequest } from '../../../desktop/externalApi/types.js';
import { resolveSession } from '../../../desktop/session/sessionResolution.js';
import { withApplyLock } from '../../../desktop/wrappers/applyMutex.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
  worksheet: z.string().min(1).describe('Worksheet name/id.'),
  showMeType: z.enum(SHOW_ME_TYPES).describe('Show Me type.'),
  dataSource: z.string().optional().describe('Internal datasource.'),
  fieldsSelectedInSchemaViewer: z
    .array(z.string())
    .optional()
    .describe('Qualified fields; omit to keep selection.'),
};
const title = 'Show Me';

export const getShowMeTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const showMeTool = new DesktopTool({
    server,
    name: 'show-me',
    minApiVersion: '0.2.11',
    title,
    description: 'Apply a Show Me type.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    paramsSchema,
    callback: async (
      { session, worksheet, showMeType, dataSource, fieldsSelectedInSchemaViewer },
      extra,
    ): Promise<CallToolResult> => {
      return await showMeTool.logAndExecute({
        extra,
        args: { session, worksheet, showMeType, dataSource, fieldsSelectedInSchemaViewer },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }

          return await withApplyLock(async () => {
            const resolvedResult = await runExternalApiReadTool({
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
                const resolved = resolveItemByNameOrId(
                  'Worksheet',
                  worksheet,
                  worksheets.value.worksheets ?? [],
                );
                return resolved.isErr() ? resolved.error.toErr() : new Ok(resolved.value);
              },
            });
            if (resolvedResult.isErr()) {
              return resolvedResult.error.toErr();
            }

            const request: WorksheetShowMeRequest = {
              showMeType,
              ...(dataSource !== undefined ? { dataSource } : {}),
              ...(fieldsSelectedInSchemaViewer !== undefined
                ? { fieldsSelectedInSchemaViewer }
                : {}),
            };
            const executor = await extra.getExecutor(sessionResult.value);
            const result = await executor.showMeWorksheet(
              resolvedResult.value.id,
              request,
              extra.signal,
            );
            if (result.isErr()) {
              if (isRouteMissing(result.error)) {
                return endpointNotInThisBuild('show-me').toErr();
              }
              return new DesktopCommandExecutionError(result.error).toErr();
            }

            const { id, name } = resolvedResult.value;
            return new Ok({
              showMeRequested: true,
              operationStatus: result.value.status,
              worksheet: { id, name },
              showMeType,
              message:
                result.value.status === 'completed'
                  ? `Desktop accepted Show Me type "${showMeType}" for worksheet "${name}". The resulting visualization was not independently verified.`
                  : `Requested Show Me type "${showMeType}" for worksheet "${name}"; Desktop is still applying it.`,
            });
          });
        },
      });
    },
  });

  return showMeTool;
};
