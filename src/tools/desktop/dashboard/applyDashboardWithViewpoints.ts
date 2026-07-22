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
import { accountDashboardViewpoints, type ViewpointAccounting } from './viewpointAccounting.js';

const paramsSchema = {
  session: z.string().optional().describe(''),
  dashboardName: z.string().describe(''),
  dashboardFile: z.string().describe(''),
  worksheetNames: z.array(z.string()).describe(''),
};

type ApplyDashboardWithViewpointsResult = {
  message: string;
  dashboardName: string;
  viewpointCount: number;
  viewpointState: ViewpointAccounting['state'];
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
      return await tool.logAndExecute<ApplyDashboardWithViewpointsResult>({
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
            const error = new DesktopCommandExecutionError(workbookResult.error);
            return new IncompleteOperationError({
              dashboardName,
              dashboardApplied: true,
              stage: 'post-dashboard-workbook-read',
              viewpoints: {
                state: 'unknown',
                requested: worksheetNames,
              },
              apply_error: error.message,
              guidance:
                `Dashboard "${dashboardName}" was applied, but the post-apply workbook re-read failed. ` +
                'Do not recreate the dashboard; re-read the workbook and retry viewpoint injection.',
            }).toErr();
          }

          const updatedWorkbookXml = injectViewpoints(
            workbookResult.value,
            dashboardName,
            worksheetNames,
          );
          const viewpointAccounting = accountDashboardViewpoints({
            beforeXml: workbookResult.value,
            afterXml: updatedWorkbookXml,
            dashboardName,
            requested: worksheetNames,
          });

          if (viewpointAccounting.state === 'failed') {
            return new IncompleteOperationError({
              dashboardName,
              dashboardApplied: true,
              stage: 'viewpoint-injection',
              viewpoints: viewpointAccounting,
              guidance:
                `Dashboard "${dashboardName}" was applied, but only ` +
                `${viewpointAccounting.landed.length}/${worksheetNames.length} requested viewpoint(s) ` +
                'were present in the post-injection workbook XML. Do not recreate the dashboard; retry ' +
                'viewpoint injection for the failed worksheets.',
            }).toErr();
          }

          if (viewpointAccounting.state === 'success-already-present') {
            return new Ok({
              message: `Dashboard "${dashboardName}" already had ${viewpointAccounting.landed.length} requested viewpoint(s).`,
              dashboardName,
              viewpointCount: viewpointAccounting.landed.length,
              viewpointState: viewpointAccounting.state,
            });
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
                return viewpointApplyIncomplete({
                  dashboardName,
                  worksheetNames,
                  viewpointAccounting,
                  state: 'unknown',
                  errorMessage: new DesktopCommandExecutionError(error).message,
                });
              case 'load-workbook-xml-error':
                return viewpointApplyIncomplete({
                  dashboardName,
                  worksheetNames,
                  viewpointAccounting,
                  state: 'failed',
                  errorMessage: new WorkbookXmlLoadFailedError(error).message,
                });
              default: {
                const _: never = type;
              }
            }
          }

          return new Ok({
            message: `Successfully applied dashboard "${dashboardName}" with ${worksheetNames.length} viewpoint(s).`,
            dashboardName,
            viewpointCount: viewpointAccounting.landed.length,
            viewpointState: viewpointAccounting.state,
          });
        },
      });
    },
  });

  return tool;
};

function viewpointApplyIncomplete({
  dashboardName,
  worksheetNames,
  viewpointAccounting,
  state,
  errorMessage,
}: {
  dashboardName: string;
  worksheetNames: string[];
  viewpointAccounting: ViewpointAccounting;
  state: 'failed' | 'unknown';
  errorMessage: string;
}): ReturnType<IncompleteOperationError<object>['toErr']> {
  return new IncompleteOperationError({
    dashboardName,
    dashboardApplied: true,
    stage: 'viewpoint-workbook-apply',
    viewpoints:
      state === 'unknown'
        ? {
            state,
            requested: worksheetNames,
            attempted: viewpointAccounting.landed,
          }
        : {
            state,
            requested: worksheetNames,
            landed: [],
            failed: worksheetNames,
          },
    apply_error: errorMessage,
    guidance:
      `Dashboard "${dashboardName}" was applied, but applying the workbook with viewpoints did not ` +
      `complete (${errorMessage}). Do not recreate the dashboard; re-read the workbook before retrying ` +
      'viewpoint injection.',
  }).toErr();
}
