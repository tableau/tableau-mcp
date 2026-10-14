import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { checkCacheFileArg } from '../../../../desktop/cachePath.js';
import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
import { checkSidecar } from '../../../../desktop/wrappers/cacheFingerprint.js';
import { loadDashboardXml } from '../../../../desktop/wrappers/loadDashboardXml.js';
import {
  DashboardXmlLoadFailedError,
  DesktopCommandExecutionError,
} from '../../../../errors/mcpToolError.desktop.js';
import {
  CacheSessionMismatchError,
  WorkbookNotFoundError,
} from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { type WithDesktopWarnings, withDesktopWarnings } from '../../api/applyPreamble.js';
import { jsonToolResult } from '../../structuredContent.js';
import { DesktopTool } from '../../tool.js';
import {
  buildDashboardXml,
  computeZones,
  layoutSpecSchema,
  validateLayoutSpec,
} from './dashboardZones.js';

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
    description: 'Build/apply; older Desktop needs views.',
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
      return await tool.logAndExecute<WithDesktopWarnings<BuildAndApplyDashboardResult>>({
        extra,
        getSuccessResult: (result) => jsonToolResult(result, { isError: false }),
        args: { session, dashboardName, dashboardFile, workbookFile, layoutSpec, worksheetNames },
        callback: async () => {
          const checkedWorkbook = checkCacheFileArg(
            'workbookFile',
            workbookFile,
            (path) => new WorkbookNotFoundError(`Workbook cache file not found: ${path}`),
          );
          if (checkedWorkbook.isErr()) return checkedWorkbook.error.toErr();

          const checkedDashboard = checkCacheFileArg(
            'dashboardFile',
            dashboardFile,
            (path) => new WorkbookNotFoundError(`Dashboard cache file not found: ${path}`),
          );
          if (checkedDashboard.isErr()) return checkedDashboard.error.toErr();

          const layoutError = validateLayoutSpec(layoutSpec, titleText);
          if (layoutError) return layoutError.toErr();

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
          const wbSidecar = checkSidecar(checkedWorkbook.value, resolvedSession, 'workbook');
          if (!wbSidecar.ok) {
            return new CacheSessionMismatchError(wbSidecar.message!).toErr();
          }
          const dashSidecar = checkSidecar(checkedDashboard.value, resolvedSession, 'dashboard');
          if (!dashSidecar.ok) {
            return new CacheSessionMismatchError(dashSidecar.message!).toErr();
          }

          const executor = await extra.getExecutor(resolvedSession);

          // The shared wrapper checks registration support and verifies the surgical write's readback.
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

          return new Ok(
            withDesktopWarnings(
              {
                message: `Successfully built and applied dashboard "${dashboardName}".`,
                dashboardName,
                kpiCount: layoutSpec.kpis.length,
                chartCount: layoutSpec.charts.length,
                viewpointCount: worksheetNames.length,
                viewpointState: 'success',
              },
              dashboardApplyResult.value.documentWarnings,
              `Built and applied dashboard "${dashboardName}"`,
            ),
          );
        },
      });
    },
  });

  return tool;
};
