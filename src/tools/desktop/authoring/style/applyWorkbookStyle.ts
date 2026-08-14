import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { currentEpisodeId, emitEpisodeEvent } from '../../../../desktop/episode-events.js';
import type { ExecuteCommandError } from '../../../../desktop/externalApi/executorTypes.js';
import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
import { getWorkbookXml } from '../../../../desktop/wrappers/getWorkbookXml.js';
import {
  describeLoadWorkbookXmlError,
  loadWorkbookXml,
  type LoadWorkbookXmlError,
} from '../../../../desktop/wrappers/loadWorkbookXml.js';
import { pollReadback } from '../../../../desktop/wrappers/pollReadback.js';
import {
  DesktopCommandExecutionError,
  IncompleteOperationError,
} from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { getExceptionMessage } from '../../../../utils/getExceptionMessage.js';
import { sessionParam } from '../../params.js';
import {
  attachNextAction,
  doneNextAction,
  jsonToolResult,
  prefillNextAction,
  receipt,
  type StructuredResult,
  withNextAction,
} from '../../structuredContent.js';
import { DesktopTool } from '../../tool.js';
import {
  analyticalFingerprint,
  eligibleStyleScopeFingerprint,
  workbookStyleStateFingerprint,
} from './analyticalFingerprint.js';
import { type EligibleStyleArtifact, eligibleStyleArtifacts } from './eligibleArtifacts.js';
import { parseStylePack, type TableauStylePackV2, tableauStylePackV2Schema } from './stylePack.js';
import {
  applyWorkbookStyle,
  type WorkbookStyleFinding,
  type WorkbookStyleResult,
} from './workbookStyle.js';

const paramsSchema = {
  session: sessionParam({ max: 64 }),
  stylePack: tableauStylePackV2Schema.describe('Exact style pack.'),
};

type Verification = {
  status: 'passed' | 'not-needed' | 'not-run' | 'unknown';
  analyticalFingerprint: 'passed' | 'mismatch' | 'not-run' | 'unknown';
  idempotence: 'passed' | 'not-needed' | 'not-run' | 'unknown';
  message?: string;
};

type ApplyWorkbookStylePayload = {
  applied: true | false | 'unknown';
  retrySafe: boolean;
  changedEligibleIds: string[];
  unchangedEligibleIds: string[];
  findings: WorkbookStyleFinding[];
  verification: Verification;
};

type ApplyWorkbookStyleToolResult = StructuredResult<ApplyWorkbookStylePayload>;

const UNVERIFIED = ['rendered appearance, marks, and exported images were not checked'] as const;

export const getApplyWorkbookStyleTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'apply-workbook-style',
    title: 'Apply Workbook Style',
    description: 'Apply a validated style pack once.',
    paramsSchema,
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
    callback: async ({ session, stylePack }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<ApplyWorkbookStyleToolResult>({
        extra,
        args: { session, stylePack },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return preDispatchFailure(sessionResult.error.getErrorText());
          }
          const resolvedSession = sessionResult.value;
          const executor = await extra.getExecutor(resolvedSession);

          const baselineResult = await executor.getWorkbookDocument(extra.signal);
          if (baselineResult.isErr()) {
            return preDispatchFailure(commandErrorText(baselineResult.error));
          }
          const inventoryResult = await executor.getWorkbook(extra.signal);
          if (inventoryResult.isErr()) {
            return preDispatchFailure(commandErrorText(inventoryResult.error));
          }

          let parsedPack: TableauStylePackV2;
          let eligible: EligibleStyleArtifact[];
          let baselineFingerprint: string;
          let baselineStyleScopeFingerprint: string;
          let transformed: WorkbookStyleResult;
          try {
            parsedPack = parseStylePack(stylePack);
            eligible = eligibleStyleArtifacts(inventoryResult.value, baselineResult.value.xml);
            baselineFingerprint = analyticalFingerprint(baselineResult.value.xml);
            baselineStyleScopeFingerprint = eligibleStyleScopeFingerprint(
              baselineResult.value.xml,
              eligible,
            );
            transformed = applyWorkbookStyle(baselineResult.value.xml, parsedPack, eligible);
          } catch (error) {
            return preDispatchFailure(getExceptionMessage(error));
          }

          let candidateFingerprint: string;
          try {
            candidateFingerprint = analyticalFingerprint(transformed.workbookXml);
          } catch (error) {
            return preDispatchFailure(getExceptionMessage(error), transformed);
          }
          if (candidateFingerprint !== baselineFingerprint) {
            return new IncompleteOperationError(
              payloadFrom(transformed, false, true, {
                status: 'not-run',
                analyticalFingerprint: 'mismatch',
                idempotence: 'not-run',
                message: 'Candidate changed the analytical workbook fingerprint; nothing was sent.',
              }),
            ).toErr();
          }
          if (
            eligibleStyleScopeFingerprint(transformed.workbookXml, eligible) !==
            baselineStyleScopeFingerprint
          ) {
            return new IncompleteOperationError(
              payloadFrom(transformed, false, true, {
                status: 'not-run',
                analyticalFingerprint: 'mismatch',
                idempotence: 'not-run',
                message:
                  'Candidate changed workbook content outside eligible style targets; nothing was sent.',
              }),
            ).toErr();
          }
          const candidateStyleStateFingerprint = workbookStyleStateFingerprint(
            transformed.workbookXml,
          );

          if (transformed.changedEligibleIds.length === 0) {
            const payload = payloadFrom(transformed, false, true, {
              status: 'not-needed',
              analyticalFingerprint: 'passed',
              idempotence: 'not-needed',
            });
            return Ok(
              withNextAction(
                payload,
                doneNextAction(
                  receipt({
                    did: [
                      'No supported style changes were needed: existing targets already matched, or this workbook had no supported target for those values.',
                    ],
                    didNot: findingReceiptLines(transformed.findings),
                    unverified: UNVERIFIED,
                  }),
                  'No supported style changes needed',
                ),
              ),
            );
          }

          if (!baselineResult.value.instanceId) {
            return preDispatchFailure(
              'The live workbook did not report an instance ID; guarded style apply was not sent.',
              transformed,
            );
          }

          let dispatched = false;
          const applyResult = await loadWorkbookXml({
            xml: transformed.workbookXml,
            baselineXml: baselineResult.value.xml,
            expectedWorkbookXml: baselineResult.value.xml,
            focus: { navigate: 'restore' },
            applyOptions: {
              expectedInstanceId: baselineResult.value.instanceId,
              onDispatch: () => {
                dispatched = true;
              },
            },
            executor,
            signal: extra.signal,
          });
          if (applyResult.isErr()) {
            const message = loadErrorText(applyResult.error);
            return dispatched
              ? unknownFailure(transformed, message)
              : preDispatchFailure(message, transformed, 'passed');
          }

          const verify = (xml: string): boolean =>
            readbackMatches(
              xml,
              baselineFingerprint,
              candidateStyleStateFingerprint,
              parsedPack,
              eligible,
            );
          const readback = await pollReadback({
            read: () => getWorkbookXml({ executor, signal: extra.signal }),
            settled: verify,
            signal: extra.signal,
          });
          if (!readback.ok) {
            return unknownFailure(transformed, commandErrorText(readback.error));
          }
          if (!readback.settled || !verify(readback.value)) {
            return unknownFailure(
              transformed,
              'Readback did not preserve the analytical fingerprint with zero remaining eligible style changes.',
            );
          }

          await emitEpisodeEvent(extra.config, {
            type: 'apply_succeeded',
            session_id: resolvedSession,
            episode_id: currentEpisodeId(resolvedSession),
            tool: 'apply-workbook-style',
            operation: 'load-workbook-style',
            promise_outcome: 'verified',
          });

          const payload = payloadFrom(transformed, true, false, {
            status: 'passed',
            analyticalFingerprint: 'passed',
            idempotence: 'passed',
          });
          return Ok(
            withNextAction(
              payload,
              doneNextAction(
                receipt({
                  did: [
                    'Sent one guarded workbook style update and observed a settled readback.',
                    'Matched the settled readback to the original analytical fingerprint and zero remaining eligible style changes.',
                  ],
                  didNot: findingReceiptLines(transformed.findings),
                  unverified: UNVERIFIED,
                }),
                'Workbook style applied and verified',
              ),
            ),
          );
        },
        getSuccessResult: (result) => jsonToolResult(result, { isError: false }),
      });
    },
  });
  return tool;
};

function readbackMatches(
  xml: string,
  baselineFingerprint: string,
  candidateStyleStateFingerprint: string,
  stylePack: TableauStylePackV2,
  eligible: EligibleStyleArtifact[],
): boolean {
  try {
    if (analyticalFingerprint(xml) !== baselineFingerprint) return false;
    if (workbookStyleStateFingerprint(xml) !== candidateStyleStateFingerprint) return false;
    return applyWorkbookStyle(xml, stylePack, eligible).changedEligibleIds.length === 0;
  } catch {
    return false;
  }
}

function payloadFrom(
  transformed: WorkbookStyleResult,
  applied: ApplyWorkbookStylePayload['applied'],
  retrySafe: boolean,
  verification: Verification,
): ApplyWorkbookStylePayload {
  return {
    applied,
    retrySafe,
    changedEligibleIds: transformed.changedEligibleIds,
    unchangedEligibleIds: transformed.unchangedEligibleIds,
    findings: transformed.findings,
    verification,
  };
}

function preDispatchFailure(
  message: string,
  transformed?: WorkbookStyleResult,
  analyticalFingerprint: Verification['analyticalFingerprint'] = 'not-run',
): ReturnType<IncompleteOperationError<ApplyWorkbookStylePayload>['toErr']> {
  const payload: ApplyWorkbookStylePayload = {
    applied: false,
    retrySafe: true,
    changedEligibleIds: transformed?.changedEligibleIds ?? [],
    unchangedEligibleIds: transformed?.unchangedEligibleIds ?? [],
    findings: transformed?.findings ?? [],
    verification: {
      status: 'not-run',
      analyticalFingerprint,
      idempotence: 'not-run',
      message: boundedMessage(message),
    },
  };
  return new IncompleteOperationError(payload).toErr();
}

function unknownFailure(
  transformed: WorkbookStyleResult,
  detail: string,
): ReturnType<IncompleteOperationError<ApplyWorkbookStylePayload>['toErr']> {
  const payload = payloadFrom(transformed, 'unknown', false, {
    status: 'unknown',
    analyticalFingerprint: 'unknown',
    idempotence: 'unknown',
    message: boundedMessage(
      `Applied state unknown. ${detail} Inspect workbook state. Do not retry.`,
    ),
  });
  return new IncompleteOperationError(
    attachNextAction(
      payload,
      prefillNextAction('Inspect workbook state; do not retry style apply'),
    ),
  ).toErr();
}

function findingReceiptLines(findings: WorkbookStyleFinding[]): string[] {
  return findings.map(({ code, message }) => {
    if (code.endsWith('-unsupported')) return `${message} (${code})`;
    if (code.endsWith('-advisory')) {
      return `Advisory only (${code}); no semantic workbook rewrite was attempted`;
    }
    if (code.endsWith('-arity-mismatch')) {
      return `Skipped by apply-workbook-style (${code}); existing palette arity did not match`;
    }
    return `Additional style finding (${code}); inspect the bounded finding details`;
  });
}

function boundedMessage(message: string): string {
  return message.length <= 512 ? message : `${message.slice(0, 509)}...`;
}

function commandErrorText(error: ExecuteCommandError): string {
  return new DesktopCommandExecutionError(error).getErrorText();
}

function loadErrorText(
  error:
    | { type: 'execute-command-error'; error: ExecuteCommandError }
    | { type: 'load-workbook-xml-error'; error: LoadWorkbookXmlError },
): string {
  return error.type === 'execute-command-error'
    ? commandErrorText(error.error)
    : describeLoadWorkbookXmlError(error.error);
}
