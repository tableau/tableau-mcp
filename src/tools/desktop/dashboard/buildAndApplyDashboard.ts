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

const paramsSchema = {
  session: z.string().optional(),
  dashboardName: z.string(),
  dashboardFile: z.string(),
  workbookFile: z.string(),
  title: z.string().optional(),
  layoutSpec: layoutSpecSchema,
  worksheetNames: z.array(z.string()),
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
