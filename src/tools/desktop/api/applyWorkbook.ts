import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { currentEpisodeId, emitEpisodeEvent } from '../../../desktop/episode-events.js';
import {
  formatColorMapCheck,
  formatStaleWorksheetStyleLead,
} from '../../../desktop/validation/colorMapReadback.js';
import { formatWorkbookPromiseCheck } from '../../../desktop/validation/promise-check.js';
import { getWorkbookXml } from '../../../desktop/wrappers/getWorkbookXml.js';
import { loadWorkbookXml } from '../../../desktop/wrappers/loadWorkbookXml.js';
import {
  readColorBaseline,
  readColorMapsBack,
} from '../../../desktop/wrappers/readColorMapsBack.js';
import {
  DesktopCommandExecutionError,
  WorkbookXmlLoadFailedError,
} from '../../../errors/mcpToolError.desktop.js';
import { UnknownError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { artifactFileParam, sessionParam } from '../params.js';
import { jsonToolResult, prefillNextAction, withNextAction } from '../structuredContent.js';
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
    description:
      'Apply modified workbook content to Tableau. When the cache has source metadata, ' +
      'a freshness check rejects workbook changes made since the read.',
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
          const { xml: workbookXml, resolvedSession, sourceHash } = preamble.value;

          const executor = await extra.getExecutor(resolvedSession);
          // Read before the apply, outside the apply lock.
          const baselineXml = await readColorBaseline({
            appliedXml: workbookXml,
            read: () => getWorkbookXml({ executor, signal: extra.signal }),
          });
          // A whole-workbook apply names no single artifact, so give the user their sheet back.
          const result = await loadWorkbookXml({
            xml: workbookXml,
            expectedSourceHash: sourceHash,
            cachedLiveRelative: true,
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
          const documentWarnings = result.isOk() ? (result.value.documentWarnings ?? []) : [];
          const diagnostics = result.isOk() ? result.value.diagnostics : undefined;
          const diagnosticsInvalid = result.isOk() && result.value.diagnosticsInvalid === true;
          const verification = await readColorMapsBack({
            appliedXml: workbookXml,
            baselineXml,
            workbookApply: true,
            executor,
            signal: extra.signal,
          });
          const hostVerification = result.isOk()
            ? `${formatWorkbookPromiseCheck(validationWarnings, documentWarnings)}${
                verification === undefined ? '' : formatColorMapCheck(verification)
              }`
            : '';
          if (result.isOk()) {
            await emitEpisodeEvent(extra.config, {
              type: 'apply_succeeded',
              session_id: resolvedSession,
              episode_id: currentEpisodeId(resolvedSession),
              tool: 'apply-workbook',
              operation: 'load-workbook',
              promise_outcome: verification?.status === 'failed' ? 'failed' : 'unverified',
            });
          }

          // The shared structured receipt mirrors the text above and nothing more:
          // dispatch and preflight warnings were observed; the applied structure was
          // not, so it is listed as unverified (promise_outcome 'unverified' above).
          const diagnosticsCoverage = diagnosticsInvalid
            ? 'invalid'
            : diagnostics
              ? diagnostics.worksheets.length > 0 &&
                diagnostics.worksheets.every((worksheet) => worksheet.status === 'complete')
                ? 'complete'
                : 'incomplete'
              : 'absent';
          const hasInvalidFields = diagnostics?.worksheets.some(
            (worksheet) => (worksheet.invalidFields?.length ?? 0) > 0,
          );
          const accepted = acceptedNoReadbackApplyResult({
            kind: 'workbook',
            preflightWarnings: validationWarnings,
            resultWarnings: documentWarnings,
            hostVerification,
            verification,
            ...(diagnosticsCoverage === 'incomplete'
              ? {
                  messageSuffix:
                    ' Diagnostics are partial; not all worksheet diagnostics completed.',
                  additionalUnverified: ['not all worksheet diagnostics completed'],
                }
              : diagnosticsCoverage === 'invalid'
                ? {
                    messageSuffix:
                      ' Diagnostics are unavailable because Desktop returned malformed diagnostics.',
                    additionalUnverified: ['static field diagnostics were unavailable'],
                  }
                : {}),
          });
          const guided = {
            ...accepted,
            message:
              `${accepted.message} The edit was accepted; address the reported invalid fields ` +
              'without replaying the apply. Static diagnostics do not establish query execution or rendering success.',
          };
          // A color failure's next action (already on `accepted`) wins over the invalid-fields one.
          const acceptedWithGuidance = !hasInvalidFields
            ? accepted
            : verification?.status === 'failed'
              ? guided
              : withNextAction(
                  guided,
                  prefillNextAction(
                    documentWarnings.length > 0
                      ? 'Fix invalid fields; tell the user what Desktop warned about'
                      : 'Address invalid fields reported in diagnostics',
                  ),
                );
          return new Ok({
            ...acceptedWithGuidance,
            message: `${formatStaleWorksheetStyleLead(verification)}${acceptedWithGuidance.message}`,
            ...(diagnostics ? { diagnostics } : {}),
            ...(diagnosticsInvalid ? { diagnosticsInvalid: true } : {}),
            ...(documentWarnings.length > 0 ? { warnings: documentWarnings } : {}),
          });
        },
        getSuccessResult: (result) => jsonToolResult(result, { isError: false }),
      });
    },
  });

  return applyWorkbookTool;
};
