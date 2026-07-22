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
import { IncompleteOperationError } from '../incompleteOperationError.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().optional().describe(''),
  dashboardName: z.string().describe(''),
  dashboardFile: z.string().describe(''),
  worksheetNames: z.array(z.string()).describe(''),
};

const title = 'Apply Dashboard with Viewpoints';
export const getApplyDashboardWithViewpointsTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'apply-dashboard-with-viewpoints',
    title,
    description: 'Apply dashboard layout and register worksheet viewpoints.',
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

          // Apply the dashboard first. A new dashboard has no dashboard window in the
          // pre-apply workbook, so injecting viewpoints before this step is a silent no-op.
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

          // Re-read after dashboard apply so its window exists, then inject viewpoints.
          const workbookResult = await getWorkbookXml({ executor, signal: extra.signal });
          if (workbookResult.isErr()) {
            return new DesktopCommandExecutionError(workbookResult.error).toErr();
          }

          const updatedWorkbookXml = injectViewpoints(
            workbookResult.value,
            dashboardName,
            worksheetNames,
          );

          if (worksheetNames.length > 0 && updatedWorkbookXml === workbookResult.value) {
            return new IncompleteOperationError({
              dashboardName,
              dashboardApplied: true,
              viewpointCount: 0,
              requestedViewpointCount: worksheetNames.length,
              failedViewpoints: worksheetNames,
              guidance:
                `Dashboard "${dashboardName}" was applied, but no dashboard window was found after apply, ` +
                'so no viewpoints were injected. Re-read the live workbook and retry viewpoint injection.',
            }).toErr();
          }

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
