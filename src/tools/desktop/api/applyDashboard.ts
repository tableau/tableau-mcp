import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { currentEpisodeId, emitEpisodeEvent } from '../../../desktop/episode-events.js';
import { loadDashboardXml } from '../../../desktop/wrappers/loadDashboardXml.js';
import {
  DashboardXmlLoadFailedError,
  DesktopCommandExecutionError,
} from '../../../errors/mcpToolError.desktop.js';
import { UnknownError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { artifactFileParam, artifactNameParam, sessionParam } from '../params.js';
import { jsonToolResult } from '../structuredContent.js';
import { DesktopTool } from '../tool.js';
import { acceptedDashboardLoadResult, runApplyPreamble } from './applyPreamble.js';

const paramsSchema = {
  session: sessionParam(),
  dashboardName: artifactNameParam('dashboard'),
  dashboardFile: artifactFileParam('dashboard').optional(),
};

const title = 'Applying changes';
export const getApplyDashboardTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const applyDashboardTool = new DesktopTool({
    server,
    name: 'apply-dashboard',
    title,
    description:
      'Apply modified dashboard layout to Tableau. When the cache has source metadata, ' +
      'a freshness check rejects changes to this dashboard since the read.',
    paramsSchema,
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    callback: async ({ session, dashboardName, dashboardFile }, extra): Promise<CallToolResult> => {
      return await applyDashboardTool.logAndExecute({
        extra,
        args: { session, dashboardName, dashboardFile },
        callback: async () => {
          const preamble = runApplyPreamble({
            kind: 'dashboard',
            file: dashboardFile,
            session,
            emptyPathGuidance:
              'Use a cached dashboard path, edit it with read-cached-xml and ' +
              'write-cached-xml, then pass that path here.',
            notFoundGuidance: 'Provide an existing cached dashboard path.',
          });
          if (preamble.isErr()) {
            return preamble;
          }
          const { xml: dashboardXml, resolvedSession, sourceHash } = preamble.value;

          const executor = await extra.getExecutor(resolvedSession);
          const result = await loadDashboardXml({
            dashboardName,
            xml: dashboardXml,
            expectedSourceHash: sourceHash,
            focus: { navigate: 'artifact', sheetName: dashboardName },
            executor,
            signal: extra.signal,
            // apply-dashboard updates an existing dashboard in place via the per-sheet `/document`
            // route; a name that does not resolve surfaces as an error rather than creating a
            // dashboard through the whole-workbook path.
            requireExistingSheet: true,
          });

          if (result.isErr()) {
            const { type, error } = result.error;
            switch (type) {
              case 'execute-command-error':
                return new DesktopCommandExecutionError(error).toErr();
              case 'load-dashboard-xml-error':
                return new DashboardXmlLoadFailedError(error).toErr();
              default: {
                // Exhaustive: an unexpected error type must never fall through to the
                // success path and mint a receipt for an apply that was not observed.
                const _: never = type;
                return new UnknownError(error).toErr();
              }
            }
          }

          // Presence, not length: a readback that ran over zero worksheets still passed.
          const readbackVerified = result.value.verifiedWorksheetNames !== undefined;
          const warned = result.value.documentWarnings.length > 0;
          await emitEpisodeEvent(extra.config, {
            type: 'apply_succeeded',
            session_id: resolvedSession,
            episode_id: currentEpisodeId(resolvedSession),
            tool: 'apply-dashboard',
            operation: 'load-dashboard',
            promise_outcome: readbackVerified && !warned ? 'verified' : 'unverified',
          });

          // Without a readback only dispatch, preflight and Desktop's warnings were observed; the
          // applied structure stays unverified.
          return new Ok(
            acceptedDashboardLoadResult({
              kind: 'dashboard',
              loaded: result.value,
              fallbackName: dashboardName,
              readbackVerified,
            }),
          );
        },
        getSuccessResult: (result) => jsonToolResult(result, { isError: false }),
      });
    },
  });

  return applyDashboardTool;
};
