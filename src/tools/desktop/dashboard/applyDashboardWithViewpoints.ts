import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getWorkbookXml } from '../../../desktop/commands/workbook/getWorkbookXml.js';
import { injectViewpoints } from '../../../desktop/commands/workbook/injectViewpoints.js';
import { loadDashboardXml } from '../../../desktop/commands/workbook/loadDashboardXml.js';
import { loadWorkbookXml } from '../../../desktop/commands/workbook/loadWorkbookXml.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import {
  ArgsValidationError,
  DashboardXmlLoadFailedError,
  DesktopCommandExecutionError,
  FileReadError,
  WorkbookNotFoundError,
  WorkbookXmlLoadFailedError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  dashboardName: z.string().describe('Name of the dashboard.'),
  dashboardFile: z.string().describe('Cached dashboard XML file to apply.'),
  worksheetNames: z.array(z.string()).describe('Worksheet viewpoints to register.'),
};

const title = 'Apply Dashboard with Viewpoints';
export const getApplyDashboardWithViewpointsTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'apply-dashboard-with-viewpoints',
    title,
    description: [
      'Apply dashboard XML and register worksheet viewpoints (mutating).',
      'Use after all worksheet files have been applied.',
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
      { session, dashboardName, dashboardFile, worksheetNames },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { session, dashboardName, dashboardFile, worksheetNames },
        callback: async () => {
          if (!existsSync(dashboardFile)) {
            return new WorkbookNotFoundError(
              `Cached dashboard file not found: ${dashboardFile}`,
            ).toErr();
          }

          let dashboardXml: string;
          try {
            dashboardXml = readFileSync(dashboardFile, 'utf-8');
          } catch (error) {
            return new FileReadError(error).toErr();
          }

          if (!dashboardXml.trim()) {
            return new ArgsValidationError(`Dashboard file is empty: ${dashboardFile}`).toErr();
          }

          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;
          const executor = await extra.getExecutor(resolvedSession);

          // Fetch current workbook, inject viewpoints, apply workbook
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

          // Apply dashboard XML
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
            message: `Successfully applied dashboard "${dashboardName}" with ${worksheetNames.length} viewpoint(s).`,
            dashboardName,
            viewpointCount: worksheetNames.length,
          });
        },
      });
    },
  });

  return tool;
};
