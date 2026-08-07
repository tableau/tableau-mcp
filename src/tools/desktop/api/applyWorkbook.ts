import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { currentEpisodeId, emitEpisodeEvent } from '../../../desktop/episode-events.js';
import { formatWorkbookPromiseCheck } from '../../../desktop/validation/promise-check.js';
import { loadWorkbookXml } from '../../../desktop/wrappers/loadWorkbookXml.js';
import {
  DesktopCommandExecutionError,
  UnknownError,
  WorkbookXmlLoadFailedError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { artifactFileParam, sessionParam } from '../params.js';
import { jsonToolResult } from '../structuredContent.js';
import { DesktopTool } from '../tool.js';
import { acceptedNoReadbackApplyResult, runApplyPreamble } from './applyPreamble.js';

const paramsSchema = {
  session: sessionParam(),
  workbookFile: artifactFileParam('workbook').optional(),
};

const title = 'Updating workbook';
export const getApplyWorkbookTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const applyWorkbookTool = new DesktopTool({
    server,
    name: 'apply-workbook',
    title,
    description: 'Apply modified workbook content to Tableau.',
    paramsSchema,
    annotations: {
      readOnlyHint: false, // writes cache files and updates workbook
      openWorldHint: false,
      destructiveHint: true, // updates active workbook
      idempotentHint: false, // each call creates a new cache file
    },
    callback: async ({ session, workbookFile }, extra): Promise<CallToolResult> => {
      return await applyWorkbookTool.logAndExecute({
        extra,
        args: { session, workbookFile },
        callback: async () => {
          const preamble = runApplyPreamble({
            kind: 'workbook',
            file: workbookFile,
            session,
            emptyPathGuidance:
              'Get one from resolve-field, edit it with read-cached-xml and ' +
              'write-cached-xml, then pass that path here.',
            notFoundGuidance: 'Provide a cached path returned by resolve-field.',
          });
          if (preamble.isErr()) {
            return preamble;
          }
          const { xml: workbookXml, resolvedSession } = preamble.value;

          const executor = await extra.getExecutor(resolvedSession);
          // A whole-workbook apply names no single artifact, so give the user their sheet back.
          const result = await loadWorkbookXml({
            xml: workbookXml,
            focus: { navigate: 'restore' },
            executor,
            signal: extra.signal,
          });

          if (result.isErr()) {
            const { type, error } = result.error;
            switch (type) {
              case 'execute-command-error':
                return new DesktopCommandExecutionError(error).toErr();
              case 'load-workbook-xml-error':
                return new WorkbookXmlLoadFailedError(error).toErr();
              default: {
                // Exhaustive: an unexpected error type must never fall through to the
                // success path and mint a receipt for an apply that was not observed.
                const _: never = type;
                return new UnknownError(error).toErr();
              }
            }
          }

          // Host verification receipt (W-23447506): whole-workbook applies have
          // no structural readback, so say so honestly instead of implying
          // full re-verification happened.
          const validationWarnings = result.isOk() ? result.value.validationWarnings : [];
          const hostVerification = result.isOk()
            ? formatWorkbookPromiseCheck(validationWarnings)
            : '';
          if (result.isOk()) {
            await emitEpisodeEvent(extra.config, {
              type: 'apply_succeeded',
              session_id: resolvedSession,
              episode_id: currentEpisodeId(resolvedSession),
              tool: 'apply-workbook',
              operation: 'load-workbook',
              promise_outcome: 'unverified',
            });
          }

          // The shared structured receipt mirrors the text above and nothing more:
          // dispatch and preflight warnings were observed; the applied structure was
          // not, so it is listed as unverified (promise_outcome 'unverified' above).
          return new Ok(
            acceptedNoReadbackApplyResult({
              kind: 'workbook',
              resultWarnings: validationWarnings,
              hostVerification,
            }),
          );
        },
        getSuccessResult: (result) => jsonToolResult(result, { isError: false }),
      });
    },
  });

  return applyWorkbookTool;
};
