import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { type Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { currentEpisodeId, emitEpisodeEvent } from '../../../../desktop/episode-events.js';
import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
import { withApplyLock } from '../../../../desktop/wrappers/applyMutex.js';
import { getWorkbookXml } from '../../../../desktop/wrappers/getWorkbookXml.js';
import { pollReadback } from '../../../../desktop/wrappers/pollReadback.js';
import { IncompleteOperationError } from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { getExceptionMessage } from '../../../../utils/getExceptionMessage.js';
import { workbookTargetFingerprint } from '../../api/workbookTargetFingerprint.js';
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
import { parseCustomThemeJson } from './customTheme.js';
import { readAppliedCustomThemeName } from './customThemeWorkbook.js';

const REDACTED_THEME_JSON = '[redacted custom theme JSON]';
const CONFLICT_POLICY = 'Preserve' as const;

const paramsSchema = {
  session: sessionParam({ max: 64 }),
  themeJson: z
    .string()
    .min(2)
    .max(64 * 1024),
  themeSha256: z.string().regex(/^[0-9a-f]{64}$/),
  expectedWorkbookTarget: z.string().regex(/^[0-9a-f]{64}$/),
};

type Verification = {
  status: 'passed' | 'not-run' | 'unknown';
  themeReference: 'passed' | 'not-run' | 'unknown';
  message?: string;
};

type ApplyWorkbookStylePayload = {
  applied: true | false | 'unknown';
  retrySafe: boolean;
  conflictPolicy: typeof CONFLICT_POLICY;
  themeName: string;
  themeSha256: string;
  verification: Verification;
};

type ApplyWorkbookStyleToolResult = StructuredResult<ApplyWorkbookStylePayload>;

export const getApplyWorkbookStyleTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'apply-workbook-style',
    title: 'Apply Workbook Style',
    description: 'Apply a Tableau Custom Theme to the whole workbook with Preserve.',
    paramsSchema,
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
    callback: async (
      { session, themeJson, themeSha256, expectedWorkbookTarget },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute<ApplyWorkbookStyleToolResult>({
        extra,
        args: { session, themeJson: REDACTED_THEME_JSON, themeSha256, expectedWorkbookTarget },
        callback: async () => {
          const themeName = `studio-theme-${themeSha256.slice(0, 12)}`;
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return preInvocationFailure(themeName, themeSha256, sessionResult.error.getErrorText());
          }
          const resolvedSession = sessionResult.value;

          let parsedTheme;
          try {
            parsedTheme = parseCustomThemeJson(themeJson, themeSha256);
          } catch (error) {
            return preInvocationFailure(themeName, themeSha256, getExceptionMessage(error));
          }

          let executor;
          try {
            executor = await extra.getExecutor(resolvedSession);
          } catch (error) {
            return preInvocationFailure(themeName, themeSha256, getExceptionMessage(error));
          }
          const expectedInstanceId = executor.desktopInstanceId;
          if (!expectedInstanceId) {
            return preInvocationFailure(
              themeName,
              themeSha256,
              'The Desktop executor did not report an instance ID; the theme command was not sent.',
            );
          }

          return await withApplyLock(async () => {
            let inventoryResult;
            try {
              inventoryResult = await executor.getWorkbook(extra.signal);
            } catch {
              return preInvocationFailure(
                themeName,
                themeSha256,
                'The current workbook target could not be confirmed; the theme command was not sent.',
                'Review the style guide again before applying it',
              );
            }
            if (inventoryResult.isErr()) {
              return preInvocationFailure(
                themeName,
                themeSha256,
                'The current workbook target could not be confirmed; the theme command was not sent.',
                'Review the style guide again before applying it',
              );
            }
            if (workbookTargetFingerprint(inventoryResult.value) !== expectedWorkbookTarget) {
              return preInvocationFailure(
                themeName,
                themeSha256,
                'The current workbook changed after review; the theme command was not sent.',
                'Review the style guide again before applying it',
              );
            }
            try {
              const commandResult = await executor.executeCommand({
                namespace: 'tabdoc',
                command: 'apply-theme',
                expectedInstanceId,
                args: {
                  'file-contents': parsedTheme.themeJson,
                  'file-name': parsedTheme.commandFileName,
                  'should-clear': 'false',
                  'theme-json-syntax': 'high-level',
                },
                signal: extra.signal,
              });
              if (commandResult.isErr()) {
                return unknownOutcome(
                  parsedTheme.commandFileName,
                  parsedTheme.sha256,
                  'Desktop did not confirm the native theme command outcome.',
                );
              }

              const readback = await pollReadback({
                read: () => getWorkbookXml({ executor, signal: extra.signal }),
                settled: (xml) => readAppliedCustomThemeName(xml) === parsedTheme.commandFileName,
                signal: extra.signal,
              });
              if (!readback.ok) {
                return unknownOutcome(
                  parsedTheme.commandFileName,
                  parsedTheme.sha256,
                  'Workbook readback failed after the native theme command began.',
                );
              }
              if (!readback.settled) {
                return unknownOutcome(
                  parsedTheme.commandFileName,
                  parsedTheme.sha256,
                  'Workbook readback did not confirm the requested native theme before timeout.',
                );
              }

              await emitEpisodeEvent(extra.config, {
                type: 'apply_succeeded',
                session_id: resolvedSession,
                episode_id: currentEpisodeId(resolvedSession),
                tool: 'apply-workbook-style',
                operation: 'apply-native-custom-theme',
                promise_outcome: 'verified',
              });

              const payload: ApplyWorkbookStylePayload = {
                applied: true,
                retrySafe: false,
                conflictPolicy: CONFLICT_POLICY,
                themeName: parsedTheme.commandFileName,
                themeSha256: parsedTheme.sha256,
                verification: {
                  status: 'passed',
                  themeReference: 'passed',
                  message:
                    'Workbook readback confirms Desktop selected the requested native theme.',
                },
              };
              return Ok(
                withNextAction(
                  payload,
                  doneNextAction(
                    receipt({
                      did: [
                        'Read back the workbook and confirmed Desktop selected the requested native theme through its direct theme reference.',
                        `Applied the native theme using ${CONFLICT_POLICY} conflict handling.`,
                      ],
                      unverified: [
                        'Existing local formatting may remain when Preserve applies the theme to the whole workbook.',
                        'Individual theme settings were not verified.',
                        'Workbook semantic preservation was not verified; Tableau native theme application owns semantic safety.',
                        'Rendered appearance was not verified.',
                        'Image export was not verified.',
                        'Save/reopen persistence was not verified.',
                      ],
                    }),
                    'Native workbook theme applied and verified',
                  ),
                ),
              );
            } catch {
              return unknownOutcome(
                parsedTheme.commandFileName,
                parsedTheme.sha256,
                'The native theme command began, but its final workbook state could not be confirmed.',
              );
            }
          });
        },
        getSuccessResult: (result) => jsonToolResult(result, { isError: false }),
      });
    },
  });
  return tool;
};

function preInvocationFailure(
  themeName: string,
  themeSha256: string,
  message: string,
  nextActionLabel = 'Correct the theme input, then retry once',
): Err<IncompleteOperationError<ApplyWorkbookStylePayload>> {
  const payload: ApplyWorkbookStylePayload = {
    applied: false,
    retrySafe: true,
    conflictPolicy: CONFLICT_POLICY,
    themeName,
    themeSha256,
    verification: { status: 'not-run', themeReference: 'not-run', message },
  };
  return new IncompleteOperationError(
    attachNextAction(payload, prefillNextAction(nextActionLabel)),
  ).toErr();
}

function unknownOutcome(
  themeName: string,
  themeSha256: string,
  message: string,
): Err<IncompleteOperationError<ApplyWorkbookStylePayload>> {
  const payload: ApplyWorkbookStylePayload = {
    applied: 'unknown',
    retrySafe: false,
    conflictPolicy: CONFLICT_POLICY,
    themeName,
    themeSha256,
    verification: { status: 'unknown', themeReference: 'unknown', message },
  };
  return new IncompleteOperationError(
    attachNextAction(
      payload,
      prefillNextAction('Inspect workbook state; do not retry this theme apply'),
    ),
  ).toErr();
}
