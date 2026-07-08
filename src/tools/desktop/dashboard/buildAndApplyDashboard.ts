import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getWorkbookXml } from '../../../desktop/commands/workbook/getWorkbookXml.js';
import { injectViewpoints } from '../../../desktop/commands/workbook/injectViewpoints.js';
import { loadDashboardXml } from '../../../desktop/commands/workbook/loadDashboardXml.js';
import { loadWorkbookXml } from '../../../desktop/commands/workbook/loadWorkbookXml.js';
import {
  DashboardXmlLoadFailedError,
  DesktopCommandExecutionError,
  WorkbookNotFoundError,
  WorkbookXmlLoadFailedError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';
import { buildDashboardXml, computeZones, layoutSpecSchema } from './dashboardZones.js';

const paramsSchema = {
  session: z.string().describe('Tableau instance Session ID from list-instances.'),
  dashboardName: z.string().describe('Name of the dashboard to build and apply.'),
  dashboardFile: z
    .string()
    .describe('Path to the cached empty dashboard XML (obtained from get-dashboard-xml).'),
  workbookFile: z
    .string()
    .describe('Path to the cached workbook XML (obtained from get-workbook-xml).'),
  title: z
    .string()
    .optional()
    .describe('Optional title text to display at the top of the dashboard.'),
  layoutSpec: layoutSpecSchema.describe('Layout specification for KPI strip and chart grid.'),
  worksheetNames: z
    .array(z.string())
    .describe('All worksheet names to register as viewpoints in the dashboard window.'),
};

const title = 'Build and Apply Dashboard';
export const getBuildAndApplyDashboardTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'build-and-apply-dashboard',
    title,
    description: [
      'Build dashboard layout XML from a layout spec and immediately apply it to Tableau.',
      'Constructs zones for a KPI strip and chart grid, registers viewpoints, then applies both the workbook and dashboard in one call.',
      'Designed for parallel execution alongside worksheet builders.',
    ].join(' '),
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    callback: async (
      {
        session,
        dashboardName,
        dashboardFile,
        workbookFile,
        title: titleText,
        layoutSpec,
        worksheetNames,
      },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { session, dashboardName, dashboardFile, workbookFile, layoutSpec, worksheetNames },
        callback: async () => {
          if (!existsSync(workbookFile)) {
            return new WorkbookNotFoundError(
              `Workbook cache file not found: ${workbookFile}`,
            ).toErr();
          }

          if (!existsSync(dashboardFile)) {
            return new WorkbookNotFoundError(
              `Dashboard cache file not found: ${dashboardFile}`,
            ).toErr();
          }

          // Zone math lifted to dashboardZones.ts (W60 dashboard-auto-apply spec §5/Q2) so
          // both this tool and dashboard-auto-apply share one builder. Zero behavior change.
          const zones = computeZones(titleText, layoutSpec);
          const dashboardXml = buildDashboardXml(dashboardName, zones);
          const executor = await extra.getExecutor(session);

          // Fetch workbook, inject viewpoints, apply workbook
          const workbookResult = await getWorkbookXml({ executor, signal: extra.signal });
          if (workbookResult.isErr()) {
            return new DesktopCommandExecutionError(workbookResult.error).toErr();
          }

          const updatedWorkbookXml = injectViewpoints(
            workbookResult.value,
            dashboardName,
            worksheetNames,
          );

          const workbookApplyResult = await loadWorkbookXml({
            xml: updatedWorkbookXml,
            executor,
            signal: extra.signal,
          });

          if (workbookApplyResult.isErr()) {
            const { type, error } = workbookApplyResult.error;
            switch (type) {
              case 'execute-command-error':
                return new DesktopCommandExecutionError(error).toErr();
              case 'load-workbook-xml-error':
                return new WorkbookXmlLoadFailedError(error).toErr();
              default: {
                const _: never = type;
              }
            }
          }

          // Apply dashboard
          const dashboardApplyResult = await loadDashboardXml({
            dashboardName,
            xml: dashboardXml,
            executor,
            signal: extra.signal,
          });

          if (dashboardApplyResult.isErr()) {
            const { type, error } = dashboardApplyResult.error;
            switch (type) {
              case 'execute-command-error':
                return new DesktopCommandExecutionError(error).toErr();
              case 'load-dashboard-xml-error':
                return new DashboardXmlLoadFailedError(error).toErr();
              default: {
                const _: never = type;
              }
            }
          }

          return new Ok({
            message: `Successfully built and applied dashboard "${dashboardName}".`,
            dashboardName,
            kpiCount: layoutSpec.kpis.length,
            chartCount: layoutSpec.charts.length,
            viewpointCount: worksheetNames.length,
          });
        },
      });
    },
  });

  return tool;
};
