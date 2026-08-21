import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { currentEpisodeId, emitEpisodeEvent } from '../../../desktop/episode-events.js';
import { formatDashboardPromiseCheck } from '../../../desktop/validation/promise-check.js';
import { loadStoryboardXml } from '../../../desktop/wrappers/loadDashboardXml.js';
import {
  DesktopCommandExecutionError,
  StoryboardXmlLoadFailedError,
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
  storyboardName: artifactNameParam('storyboard'),
  storyboardFile: artifactFileParam('storyboard').optional(),
};

const title = 'Apply Storyboard';
export const getApplyStoryboardTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const applyStoryboardTool = new DesktopTool({
    server,
    name: 'apply-storyboard',
    title,
    description: 'Apply modified storyboard document to Tableau.',
    paramsSchema,
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    callback: async (
      { session, storyboardName, storyboardFile },
      extra,
    ): Promise<CallToolResult> => {
      return await applyStoryboardTool.logAndExecute({
        extra,
        args: { session, storyboardName, storyboardFile },
        callback: async () => {
          const preamble = runApplyPreamble({
            kind: 'storyboard',
            file: storyboardFile,
            session,
            emptyPathGuidance:
              'Use a cached storyboard path, edit it with read-cached-xml and ' +
              'write-cached-xml, then pass that path here.',
            notFoundGuidance: 'Provide an existing cached storyboard path.',
          });
          if (preamble.isErr()) {
            return preamble;
          }
          const { xml: storyboardXml, resolvedSession } = preamble.value;

          const executor = await extra.getExecutor(resolvedSession);
          // A storyboard rides the dashboard loader (it serializes as a
          // `<dashboard type='storyboard'>`), so error cases below carry the
          // dashboard loader's 'load-dashboard-xml-error' label.
          const result = await loadStoryboardXml({
            storyboardName,
            xml: storyboardXml,
            focus: { navigate: 'artifact', sheetName: storyboardName },
            executor,
            signal: extra.signal,
            // apply-storyboard updates an existing storyboard in place via the per-sheet `/document`
            // route; a name that does not resolve surfaces as an error rather than creating a
            // storyboard through the whole-workbook path.
            requireExistingSheet: true,
          });

          if (result.isErr()) {
            const { type, error } = result.error;
            switch (type) {
              case 'execute-command-error':
                return new DesktopCommandExecutionError(error).toErr();
              case 'load-dashboard-xml-error':
                return new StoryboardXmlLoadFailedError(error).toErr();
              default: {
                // Exhaustive: an unexpected error type must never fall through to the
                // success path and mint a receipt for an apply that was not observed.
                const _: never = type;
                return new UnknownError(error).toErr();
              }
            }
          }

          // Host verification receipt (W-23447506): storyboard applies have no structural
          // readback, so say so honestly instead of implying full re-verification happened.
          // No storyboard-specific promise-check formatter exists; the dashboard one is
          // shape-identical for this shared loader.
          const validationWarnings = result.isOk() ? result.value.validationWarnings : [];
          const hostVerification = result.isOk()
            ? formatDashboardPromiseCheck(validationWarnings)
            : '';
          if (result.isOk()) {
            await emitEpisodeEvent(extra.config, {
              type: 'apply_succeeded',
              session_id: resolvedSession,
              episode_id: currentEpisodeId(resolvedSession),
              tool: 'apply-storyboard',
              operation: 'load-storyboard',
              promise_outcome: 'unverified',
            });
          }

          // A storyboard apply has no structural readback, so — when AUTO_VISUAL_CHECK is on — the
          // rendered-window scan is the only post-apply signal: a dense error-red cluster nudges
          // the model to look before reporting Done. Best-effort and never fails the apply.
          const visualWarning = await runVisualErrorCheckText({
            executor,
            signal: extra.signal,
            enabled: extra.config.autoVisualCheck,
          });

          // The shared structured receipt mirrors the text above and nothing more:
          // dispatch and preflight warnings were observed; the applied structure was
          // not, so it is listed as unverified (promise_outcome 'unverified' above).
          return new Ok(
            acceptedNoReadbackApplyResult({
              kind: 'storyboard',
              appliedName: storyboardName,
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

  return applyStoryboardTool;
};
