import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
import { loadDashboardXml } from '../../../../desktop/wrappers/loadDashboardXml.js';
import { parsedXmlNamesEqual } from '../../../../desktop/xmlElement.js';
import {
  ArgsValidationError,
  DashboardXmlLoadFailedError,
  DesktopCommandExecutionError,
  FileReadError,
  IncompleteOperationError,
  WorkbookNotFoundError,
} from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { artifactFileParam, sessionParam } from '../../params.js';
import { DesktopTool } from '../../tool.js';
import { type ViewpointAccounting } from './viewpointAccounting.js';

const paramsSchema = {
  session: sessionParam(),
  dashboardName: z.string().describe(''),
  dashboardFile: artifactFileParam('dashboard'),
  worksheetNames: z.array(z.string()).describe(''),
};

type ApplyDashboardWithViewpointsResult = {
  message: string;
  dashboardName: string;
  viewpointCount: number;
  viewpointState: ViewpointAccounting['state'];
};

const title = 'Finalizing dashboard';
export const getApplyDashboardWithViewpointsTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'apply-dashboard-with-viewpoints',
    title,
    description: 'Apply an existing dashboard layout; requires registered worksheet views.',
    paramsSchema,
    annotations: {
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
            message: `Successfully applied dashboard "${dashboardName}" with ${worksheetNames.length} viewpoint(s).`,
            dashboardName,
            viewpointCount: worksheetNames.length,
            viewpointState: 'success',
          });
        },
      });
    },
  });

  return tool;
};
