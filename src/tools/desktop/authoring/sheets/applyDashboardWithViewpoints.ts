import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { loadDashboardXml } from '../../../../desktop/wrappers/loadDashboardXml.js';
import { parsedXmlNamesEqual } from '../../../../desktop/xmlElement.js';
import {
  DashboardXmlLoadFailedError,
  DesktopCommandExecutionError,
  IncompleteOperationError,
} from '../../../../errors/mcpToolError.desktop.js';
import { ArgsValidationError } from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { runApplyPreamble } from '../../api/applyPreamble.js';
import { artifactFileParam, sessionParam } from '../../params.js';
import { DesktopTool } from '../../tool.js';

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
  viewpointState: 'success';
};

const title = 'Finalizing dashboard';
export const getApplyDashboardWithViewpointsTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'apply-dashboard-with-viewpoints',
    title,
    description: 'Apply a dashboard layout; older Desktop versions require registered views.',
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
          const preamble = runApplyPreamble({
            kind: 'dashboard',
            file: dashboardFile,
            session,
            emptyPathGuidance: 'Use a cached dashboard path from get-dashboard-xml.',
            notFoundGuidance: 'Provide an existing cached dashboard path.',
          });
          if (preamble.isErr()) {
            return preamble;
          }
          const { xml: dashboardXml, resolvedSession, sourceHash } = preamble.value;

          if (!dashboardXml.trim()) {
            return new ArgsValidationError(`Dashboard file is empty: ${dashboardFile}`).toErr();
          }

          const executor = await extra.getExecutor(resolvedSession);

          // Check registration support before a surgical write and verify its readback.
          const dashboardApplyResult = await loadDashboardXml({
            dashboardName,
            xml: dashboardXml,
            expectedSourceHash: sourceHash,
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
