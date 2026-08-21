import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { currentEpisodeId, emitEpisodeEvent } from '../../../desktop/episode-events.js';
import { formatDashboardPromiseCheck } from '../../../desktop/validation/promise-check.js';
import { loadDashboardXml } from '../../../desktop/wrappers/loadDashboardXml.js';
import {
  DashboardXmlLoadFailedError,
  DesktopCommandExecutionError,
  UnknownError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { artifactFileParam, artifactNameParam, sessionParam } from '../params.js';
import { jsonToolResult } from '../structuredContent.js';
import { DesktopTool } from '../tool.js';
import { acceptedNoReadbackApplyResult, runApplyPreamble } from './applyPreamble.js';
import { runVisualErrorCheckText } from './visualErrorCheck.js';

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
    description: 'Apply modified dashboard layout to Tableau.',
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
          const { xml: dashboardXml, resolvedSession } = preamble.value;

          const executor = await extra.getExecutor(resolvedSession);
          const result = await loadDashboardXml({
            dashboardName,
            xml: dashboardXml,
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

          // Host verification receipt (W-23447506): dashboard applies have no
          // structural readback, so say so honestly instead of implying full
          // re-verification happened.
          const validationWarnings = result.isOk() ? result.value.validationWarnings : [];
          const hostVerification = result.isOk()
            ? formatDashboardPromiseCheck(validationWarnings)
            : '';
          if (result.isOk()) {
            await emitEpisodeEvent(extra.config, {
              type: 'apply_succeeded',
              session_id: resolvedSession,
              episode_id: currentEpisodeId(resolvedSession),
              tool: 'apply-dashboard',
              operation: 'load-dashboard',
              promise_outcome: 'unverified',
            });
          }

          // A dashboard apply has no structural readback, so — when AUTO_VISUAL_CHECK is on — the
          // rendered-window scan is the only post-apply signal: a dense error-red cluster nudges
          // the model to look before reporting Done. Best-effort and never fails the apply.
          const visualWarning = await runVisualErrorCheckText({
            executor,
            signal: extra.signal,
            enabled: extra.config.autoVisualCheck,
          });

          // The shared structured receipt mirrors the text above and nothing more:
          // dispatch and preflight warnings were observed; the applied layout was not,
          // so it is listed as unverified (promise_outcome 'unverified' above).
          return new Ok(
            acceptedNoReadbackApplyResult({
              kind: 'dashboard',
              appliedName: dashboardName,
              resultWarnings: validationWarnings,
              hostVerification,
              visualWarning,
            }),
          );
        },
        getSuccessResult: (result) => jsonToolResult(result, { isError: false }),
      });
    },
  });

  return applyDashboardTool;
};
