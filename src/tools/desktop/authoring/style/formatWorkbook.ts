import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { resolveItemByNameOrId } from '../../../../desktop/externalApi/toolUtils.js';
import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
import { DesktopCommandExecutionError } from '../../../../errors/mcpToolError.desktop.js';
import { ArgsValidationError, McpToolError } from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { sessionParam } from '../../params.js';
import { DesktopTool } from '../../tool.js';
import {
  applyDashboardZoneFormat,
  cornerRadiusSchema,
  DashboardZoneFormatRequest,
  ZoneFormatReceipt,
  zoneIdsSchema,
} from './formatDashboardZones.js';
import {
  applyWorksheetFormats,
  FormattedWorksheet,
  WorksheetFormat,
  worksheetFormatSchema,
} from './formatWorksheets.js';
import { applyMemberColors, memberColorsSchema, SetMemberColorsResult } from './setMemberColors.js';

const changeSchema = z.object({
  sheet: z.string(),
  showLabels: z.boolean().optional(),
  numberFormats: z
    .array(z.record(z.unknown()))
    .optional()
    .describe('{field,kind:number|currency|percentage,decimals:0-2,displayUnits,currencySymbol}'),
  colors: z.record(z.string()).optional().describe('member: #rrggbb'),
  colorField: z.string().optional(),
  cornerRadius: z.number().int().optional(),
  zoneIds: z.array(z.string()).optional(),
});

const paramsSchema = {
  session: sessionParam(),
  changes: z.array(changeSchema).min(1).max(12),
};

type Change = z.infer<typeof changeSchema>;

type FormatWorkbookResult = {
  worksheets?: FormattedWorksheet[];
  memberColors?: SetMemberColorsResult[];
  dashboards?: ZoneFormatReceipt[];
};

export const getFormatWorkbookTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'format-workbook',
    title: 'Format Workbook',
    description: 'Format worksheets and dashboards in one call.',
    paramsSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session, changes }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<FormatWorkbookResult>({
        extra,
        args: { session, changes },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) return sessionResult.error.toErr();
          const executor = await extra.getExecutor(sessionResult.value);
          const signal = extra.signal;

          const [worksheetList, dashboardList] = await Promise.all([
            executor.listWorksheets(signal),
            executor.listDashboards(signal),
          ]);
          if (worksheetList.isErr()) {
            return new DesktopCommandExecutionError(worksheetList.error).toErr();
          }
          if (dashboardList.isErr()) {
            return new DesktopCommandExecutionError(dashboardList.error).toErr();
          }
          const routed = routeChanges(
            changes,
            worksheetList.value.worksheets ?? [],
            dashboardList.value.dashboards ?? [],
          );
          if (routed.isErr()) return routed;
          const { worksheets, memberColors, dashboards } = routed.value;

          const result: FormatWorkbookResult = {};
          let applied = 0;
          const fail = (error: McpToolError): Result<never, McpToolError> =>
            applied === 0
              ? error.toErr()
              : new McpToolError({
                  type: error.type,
                  statusCode: error.statusCode,
                  message: `${error.message} ${applied} earlier ${applied === 1 ? 'change was' : 'changes were'} already applied.`,
                }).toErr();

          if (worksheets.length > 0) {
            const formatted = await applyWorksheetFormats({ executor, worksheets, signal });
            if (formatted.isErr()) return formatted;
            result.worksheets = formatted.value.formatted;
            applied += worksheets.length;
          }
          for (const change of memberColors) {
            const colored = await applyMemberColors({ executor, ...change, signal });
            if (colored.isErr()) return fail(colored.error);
            (result.memberColors ??= []).push(colored.value);
            applied += 1;
          }
          for (const { dashboardName, request } of dashboards) {
            const rounded = await applyDashboardZoneFormat({
              executor,
              dashboardName,
              request,
              signal,
            });
            if (rounded.isErr()) return fail(rounded.error);
            (result.dashboards ??= []).push(rounded.value);
            applied += 1;
          }
          return new Ok(result);
        },
      });
    },
  });
  return tool;
};

type RoutedChanges = {
  worksheets: WorksheetFormat[];
  memberColors: Array<{
    worksheetName: string;
    colors: Array<{ member: string; color: string }>;
    field?: string;
  }>;
  dashboards: Array<{ dashboardName: string; request: DashboardZoneFormatRequest }>;
};

export function routeChanges(
  changes: Change[],
  worksheets: Array<{ id: string; name: string }>,
  dashboards: Array<{ id: string; name: string }>,
): Result<RoutedChanges, McpToolError> {
  const routed: RoutedChanges = { worksheets: [], memberColors: [], dashboards: [] };
  for (const change of changes) {
    const { sheet, showLabels, numberFormats, colors, colorField, cornerRadius, zoneIds } = change;
    const worksheetProperties = showLabels !== undefined || numberFormats !== undefined;
    const colorProperties = colors !== undefined || colorField !== undefined;
    const dashboardProperties = cornerRadius !== undefined || zoneIds !== undefined;
    if (!worksheetProperties && !colorProperties && !dashboardProperties) {
      return new ArgsValidationError(`Change for "${sheet}" sets nothing.`).toErr();
    }

    if (dashboardProperties) {
      if (worksheetProperties || colorProperties) {
        return new ArgsValidationError(
          `Change for "${sheet}" mixes dashboard and worksheet formatting.`,
        ).toErr();
      }
      const dashboard = resolveItemByNameOrId('Dashboard', sheet, dashboards);
      if (dashboard.isErr()) return dashboard.error.toErr();
      const request = dashboardRequestSchema.safeParse({ cornerRadius, zoneIds });
      if (!request.success) return invalid(sheet, request.error);
      routed.dashboards.push({
        dashboardName: dashboard.value.name,
        request: {
          cornerRadius: request.data.cornerRadius,
          scope: request.data.zoneIds === undefined ? 'all' : 'zone_ids',
          zoneIds: request.data.zoneIds,
        },
      });
      continue;
    }

    const worksheet = resolveItemByNameOrId('Worksheet', sheet, worksheets);
    if (worksheet.isErr()) return worksheet.error.toErr();
    if (worksheetProperties) {
      const format = worksheetFormatSchema.safeParse({
        name: worksheet.value.name,
        showLabels,
        numberFormats,
      });
      if (!format.success) return invalid(sheet, format.error);
      routed.worksheets.push(format.data);
    }
    if (colorProperties) {
      const memberColors = memberColorsSchema.safeParse(
        Object.entries(colors ?? {}).map(([member, color]) => ({ member, color })),
      );
      if (!memberColors.success) return invalid(sheet, memberColors.error);
      routed.memberColors.push({
        worksheetName: worksheet.value.name,
        colors: memberColors.data,
        field: colorField,
      });
    }
  }
  return new Ok(routed);
}

const dashboardRequestSchema = z.object({
  cornerRadius: cornerRadiusSchema,
  zoneIds: zoneIdsSchema,
});

function invalid(sheet: string, error: z.ZodError): Result<never, McpToolError> {
  const details = error.issues
    .map(({ path, message }) => (path.length > 0 ? `${path.join('.')}: ${message}` : message))
    .join('; ');
  return new ArgsValidationError(`Change for "${sheet}" is invalid: ${details}`).toErr();
}
