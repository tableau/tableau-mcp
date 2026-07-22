import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { checkSidecar } from '../../../desktop/commands/workbook/cacheFingerprint.js';
import { getWorkbookXml } from '../../../desktop/commands/workbook/getWorkbookXml.js';
import { injectViewpoints } from '../../../desktop/commands/workbook/injectViewpoints.js';
import { loadDashboardXml } from '../../../desktop/commands/workbook/loadDashboardXml.js';
import { loadWorkbookXml } from '../../../desktop/commands/workbook/loadWorkbookXml.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import {
  CacheSessionMismatchError,
  DashboardXmlLoadFailedError,
  DesktopCommandExecutionError,
  WorkbookNotFoundError,
  WorkbookXmlLoadFailedError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { IncompleteOperationError } from '../incompleteOperationError.js';
import { DesktopTool } from '../tool.js';
import { buildDashboardXml, computeZones, layoutSpecSchema } from './dashboardZones.js';
import { accountDashboardViewpoints, type ViewpointAccounting } from './viewpointAccounting.js';

const paramsSchema = {
  session: z.string().optional(),
  dashboardName: z.string(),
  dashboardFile: z.string(),
  workbookFile: z.string(),
  title: z.string().optional(),
  layoutSpec: layoutSpecSchema,
  worksheetNames: z.array(z.string()),
};

type BuildAndApplyDashboardResult = {
  message: string;
  dashboardName: string;
  kpiCount: number;
  chartCount: number;
  viewpointCount: number;
  viewpointState: ViewpointAccounting['state'];
};

const title = 'Build and Apply Dashboard';
export const getBuildAndApplyDashboardTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'build-and-apply-dashboard',
    title,
    description: 'Build/apply dashboard; registers viewpoints.',
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
      return await tool.logAndExecute<BuildAndApplyDashboardResult>({
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
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;

          // Cross-instance cache-bleed guard (W9): refuse caches produced by a different
          // (or restarted) Desktop session before applying either one.
          const wbSidecar = checkSidecar(workbookFile, resolvedSession, 'workbook');
          if (!wbSidecar.ok) {
            return new CacheSessionMismatchError(wbSidecar.message!).toErr();
          }
          const dashSidecar = checkSidecar(dashboardFile, resolvedSession, 'dashboard');
          if (!dashSidecar.ok) {
            return new CacheSessionMismatchError(dashSidecar.message!).toErr();
          }

          const executor = await extra.getExecutor(resolvedSession);

          // Apply the dashboard first. A newly created dashboard has no window in the
          // pre-apply workbook, so viewpoint injection must use a fresh post-apply read.
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

          // Fetch the post-apply workbook, inject viewpoints, then apply that document.
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
              message: `Successfully built and applied dashboard "${dashboardName}".`,
              dashboardName,
              kpiCount: layoutSpec.kpis.length,
              chartCount: layoutSpec.charts.length,
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
            message: `Successfully built and applied dashboard "${dashboardName}".`,
            dashboardName,
            kpiCount: layoutSpec.kpis.length,
            chartCount: layoutSpec.charts.length,
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
