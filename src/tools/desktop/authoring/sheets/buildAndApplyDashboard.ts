import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
import { checkSidecar } from '../../../../desktop/wrappers/cacheFingerprint.js';
import { loadDashboardXml } from '../../../../desktop/wrappers/loadDashboardXml.js';
import { parsedXmlNamesEqual } from '../../../../desktop/xmlElement.js';
import {
  CacheSessionMismatchError,
  DashboardXmlLoadFailedError,
  DesktopCommandExecutionError,
  IncompleteOperationError,
  WorkbookNotFoundError,
} from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { DesktopTool } from '../../tool.js';
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

type BuildAndApplyDashboardResult = {
  message: string;
  dashboardName: string;
  kpiCount: number;
  chartCount: number;
  viewpointCount: number;
  viewpointState: 'success';
};

const title = 'Building dashboard';
export const getBuildAndApplyDashboardTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'build-and-apply-dashboard',
    title,
    description: 'Edit dashboard; registered views required.',
    paramsSchema,
    annotations: {
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

          // The direct and batched dashboard paths share one zone builder.
          const zones = computeZones(titleText, layoutSpec);
          const dashboardXml = buildDashboardXml(dashboardName, zones, layoutSpec.layoutType);
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

          // Check all requested registrations before a surgical write and verify its readback.
          const dashboardApplyResult = await loadDashboardXml({
            dashboardName,
            xml: dashboardXml,
            worksheetNames,
            requireExistingSheet: true,
            verifyReadback: true,
            focus: { navigate: 'artifact', sheetName: dashboardName },
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
                return _;
              }
            }
          }

          const verifiedNames = dashboardApplyResult.value.verifiedWorksheetNames;
          if (
            !verifiedNames ||
            !worksheetNames.every((name) =>
              verifiedNames.some((verified) => parsedXmlNamesEqual(name, verified)),
            )
          ) {
            return new IncompleteOperationError({
              dashboardName,
              dashboardApplied: true,
              stage: 'viewpoint-verification',
              viewpoints: { state: 'unknown', requested: worksheetNames },
              guidance:
                'Dashboard apply completed without confirming every requested viewpoint. ' +
                'Re-read the live dashboard before retrying. Do not replace the workbook to inject viewpoints.',
            }).toErr();
          }

          return new Ok({
            message: `Successfully built and applied dashboard "${dashboardName}".`,
            dashboardName,
            kpiCount: layoutSpec.kpis.length,
            chartCount: layoutSpec.charts.length,
            viewpointCount: worksheetNames.length,
            viewpointState: 'success',
          });
        },
      });
    },
  });

  return tool;
};
