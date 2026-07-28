import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { listDashboards } from '../../../desktop/commands/workbook/listDashboards.js';
import { listWorksheets } from '../../../desktop/commands/workbook/listWorksheets.js';
import { loadDashboardXml } from '../../../desktop/commands/workbook/loadDashboardXml.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { formatDashboardPromiseCheck } from '../../../desktop/validation/promise-check.js';
import { xmlNamesEqual } from '../../../desktop/xmlElement.js';
import {
  DashboardXmlLoadFailedError,
  DesktopCommandExecutionError,
  McpToolError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';
import { buildDashboardXml, computeZones } from './dashboardZones.js';

const layoutSchema = z.object({
  layoutType: z.enum(['auto-grid', 'rows', 'columns']).describe('Zone arrangement.'),
  gridColumns: z.number().int().min(1).max(12).optional().describe('Auto-grid columns.'),
});

const paramsSchema = {
  dashboardName: z.string().trim().min(1).describe('New dashboard name.'),
  worksheets: z
    .array(z.string().trim().min(1).describe('Existing worksheet name.'))
    .min(2)
    .max(12)
    .describe('2-12 existing worksheet names.'),
  layout: layoutSchema.optional().describe('Zone layout.'),
  session: z.string().optional().describe('Desktop session ID.'),
};

type WorksheetZoneReceipt = {
  worksheet: string;
  position: { x: number; y: number; width: number; height: number };
};

type ComposeDashboardResult = {
  dashboardName: string;
  zones: WorksheetZoneReceipt[];
  verification: string;
};

function terminalError(message: string, type = 'compose-dashboard-refused'): McpToolError {
  return new McpToolError({ type, message, statusCode: 409 });
}

const title = 'Compose Dashboard';

export const getComposeDashboardTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'compose-dashboard',
    title,
    description: 'Compose a dashboard from 2-12 existing sheets; no overwrite.',
    paramsSchema,
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    callback: async (
      { dashboardName, worksheets, layout, session },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute<ComposeDashboardResult>({
        extra,
        args: { dashboardName, worksheets, layout, session },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return terminalError(
              `${sessionResult.error.message} Next call: list-instances, then call compose-dashboard again with a valid session.`,
              'compose-dashboard-session-error',
            ).toErr();
          }

          const executor = await extra.getExecutor(sessionResult.value);
          const worksheetResult = await listWorksheets({ executor, signal: extra.signal });
          if (worksheetResult.isErr()) {
            const detail = new DesktopCommandExecutionError(worksheetResult.error).message;
            return terminalError(
              `Could not read the live worksheet list (${detail}). Next call: list-worksheets, then call compose-dashboard again.`,
              'compose-dashboard-worksheet-read-error',
            ).toErr();
          }

          const availableWorksheets = worksheetResult.value.worksheets;
          const resolvedWorksheets = worksheets.map((requestedName) =>
            availableWorksheets.find((availableName) =>
              xmlNamesEqual(availableName, requestedName),
            ),
          );
          const missingWorksheets = worksheets.filter(
            (_, index) => resolvedWorksheets[index] === undefined,
          );
          if (missingWorksheets.length > 0) {
            const missing = missingWorksheets.map((name) => `"${name}"`).join(', ');
            const available =
              availableWorksheets.length > 0
                ? availableWorksheets.map((name) => `"${name}"`).join(', ')
                : '(none)';
            return terminalError(
              `Missing worksheets: ${missing}. Available worksheets: ${available}. ` +
                'Next call: compose-dashboard again using only names from Available worksheets.',
              'compose-dashboard-missing-worksheets',
            ).toErr();
          }
          const canonicalWorksheets = resolvedWorksheets as string[];

          const dashboardResult = await listDashboards({ executor, signal: extra.signal });
          if (dashboardResult.isErr()) {
            const detail = new DesktopCommandExecutionError(dashboardResult.error).message;
            return terminalError(
              `Could not read the live dashboard list (${detail}). Next call: list-dashboards, then call compose-dashboard again.`,
              'compose-dashboard-dashboard-read-error',
            ).toErr();
          }

          if (
            dashboardResult.value.dashboards.some((existingName) =>
              xmlNamesEqual(existingName, dashboardName),
            )
          ) {
            return terminalError(
              `Dashboard "${dashboardName}" already exists and was not overwritten. ` +
                'Next call: compose-dashboard again with a new dashboardName.',
              'compose-dashboard-duplicate-dashboard',
            ).toErr();
          }

          const zones = computeZones(undefined, {
            kpis: [],
            charts: canonicalWorksheets,
            layoutType: layout?.layoutType ?? 'auto-grid',
            gridColumns: layout?.gridColumns,
          });
          const dashboardXml = buildDashboardXml(dashboardName, zones);
          const applyResult = await loadDashboardXml({
            dashboardName,
            xml: dashboardXml,
            focus: { navigate: 'artifact', sheetName: dashboardName },
            executor,
            signal: extra.signal,
          });
          if (applyResult.isErr()) {
            const detail =
              applyResult.error.type === 'execute-command-error'
                ? new DesktopCommandExecutionError(applyResult.error.error).message
                : new DashboardXmlLoadFailedError(applyResult.error.error).message;
            return terminalError(
              `Dashboard "${dashboardName}" was not confirmed applied (${detail}). ` +
                'Next call: list-dashboards to check whether it exists before retrying compose-dashboard.',
              'compose-dashboard-apply-error',
            ).toErr();
          }

          const worksheetZones: WorksheetZoneReceipt[] = zones
            .filter((zone) => zone.kind === 'worksheet')
            .map((zone) => ({
              worksheet: zone.name,
              position: {
                x: zone.x,
                y: zone.y,
                width: zone.w,
                height: zone.h,
              },
            }));

          return new Ok({
            dashboardName,
            zones: worksheetZones,
            verification: formatDashboardPromiseCheck(applyResult.value.validationWarnings),
          });
        },
      });
    },
  });

  return tool;
};
