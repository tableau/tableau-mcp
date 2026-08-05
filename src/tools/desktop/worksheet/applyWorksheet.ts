import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { checkSidecar } from '../../../desktop/commands/workbook/cacheFingerprint.js';
import { loadWorksheetXml } from '../../../desktop/commands/workbook/loadWorksheetXml.js';
import { emitWorksheetPromiseEvents } from '../../../desktop/episode-events.js';
import type { WorksheetApplyState } from '../../../desktop/metadata/targetWorksheetState.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import {
  getTemplateArtifactStore,
  type TemplateArtifactReservation,
  templateArtifactSessionIdentity,
} from '../../../desktop/templates/templateArtifactStore.js';
import {
  classifyWorksheetPromiseOutcome,
  formatWorksheetPromiseCheck,
} from '../../../desktop/validation/promise-check.js';
import { formatReadbackVerificationWarnings } from '../../../desktop/validation/readback-verify.js';
import type { ValidationIssue } from '../../../desktop/validation/types.js';
import {
  ArgsValidationError,
  CacheSessionMismatchError,
  DesktopCommandExecutionError,
  FileReadError,
  IncompleteOperationError,
  WorksheetNotFoundError,
  WorksheetXmlLoadFailedError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  artifactId: z.string().uuid().optional().describe('Template artifact id.'),
  session: z.string().max(64).optional(),
  worksheetName: z.string().min(1).max(255).optional(),
  worksheetFile: z.string().max(4096).optional(),
};

const title = 'Apply Worksheet';

type ArtifactMutationOutcome = 'not-dispatched' | 'possibly-dispatched';

function artifactApplyError(
  mutationOutcome: ArtifactMutationOutcome,
  guidance: string,
): ReturnType<IncompleteOperationError<object>['toErr']> {
  return new IncompleteOperationError({ mutationOutcome, guidance }).toErr();
}

function sanitizedValidationRuleIds(issues: ValidationIssue[]): string[] {
  return [
    ...new Set(
      issues
        .map((issue) => issue.ruleId.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 80))
        .filter(Boolean),
    ),
  ].slice(0, 5);
}

function formatArtifactValidationFailure(issues: ValidationIssue[]): string {
  if (issues.some((issue) => issue.ruleId === 'connections-not-authorable')) {
    return (
      'Template artifact preflight failed (connections-not-authorable); no workbook change was sent; the artifact was consumed. ' +
      "Fix the connection in Desktop's Connect pane, then build a new artifact from the current workbook if the worksheet is still wanted."
    );
  }
  const ruleIds = sanitizedValidationRuleIds(issues);
  const finding = ruleIds.length > 0 ? ` (${ruleIds.join(', ')})` : '';
  return (
    `Template artifact preflight failed${finding}; no workbook change was sent; the artifact was consumed. ` +
    'Resolve the reported workbook issue, then build a new artifact from the current workbook if the worksheet is still wanted.'
  );
}

// WHY: ShapeOutput requires optional raw-shape keys, so retain the legacy direct-callback facade while runtime validation includes artifactId.
type ApplyWorksheetTool = DesktopTool<{
  session: typeof paramsSchema.session;
  worksheetName: typeof paramsSchema.worksheetName;
  worksheetFile: typeof paramsSchema.worksheetFile;
}>;

export const getApplyWorksheetTool = (server: DesktopMcpServer): ApplyWorksheetTool => {
  const artifactStore = getTemplateArtifactStore(server);
  const applyWorksheetTool = new DesktopTool({
    server,
    name: 'apply-worksheet',
    title,
    description: 'Apply a guarded template artifact or modified cached worksheet file to Desktop.',
    paramsSchema,
    annotations: {
      readOnlyHint: false, // updates worksheet in workbook
      openWorldHint: false,
      destructiveHint: true, // updates active workbook
      idempotentHint: false,
    },
    callback: async (
      { artifactId, session, worksheetName, worksheetFile },
      extra,
    ): Promise<CallToolResult> => {
      return await applyWorksheetTool.logAndExecute({
        extra,
        args: { artifactId, session, worksheetName, worksheetFile },
        callback: async () => {
          const artifactMode = artifactId !== undefined;
          if (artifactMode && (worksheetName !== undefined || worksheetFile !== undefined)) {
            return new ArgsValidationError(
              'artifactId cannot be combined with worksheetName or worksheetFile. Rebuild the artifact if different content is needed.',
            ).toErr();
          }

          if (!artifactMode && !worksheetName?.trim()) {
            return new ArgsValidationError(
              'A non-empty worksheetName is required when artifactId is not provided.',
            ).toErr();
          }

          let worksheetXml: string | undefined;
          if (!artifactMode) {
            // No inline document parameter: the cached file path IS the handle. Making the
            // model retype a document cost ~190s of pure emission across six asks, and
            // inline content carried no cache fingerprint, so it also skipped the
            // cross-instance bleed guard below.
            if (!worksheetFile?.trim()) {
              return new ArgsValidationError(
                [
                  'A non-empty worksheet file path is required.',
                  'Get one from get-worksheet-xml, edit it with read-cached-xml and',
                  'write-cached-xml, then pass that path here.',
                ].join(' '),
              ).toErr();
            }

            if (!existsSync(worksheetFile)) {
              return new WorksheetNotFoundError(
                [
                  `Cached worksheet file not found: ${worksheetFile}`,
                  'Provide a path returned by get-worksheet-xml.',
                ].join(' '),
              ).toErr();
            }

            try {
              worksheetXml = readFileSync(worksheetFile, 'utf-8');
            } catch (error) {
              return new FileReadError(error).toErr();
            }
          }

          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;

          if (!artifactMode && worksheetFile) {
            // Cross-instance cache-bleed guard (W9): refuse a cache file produced by a
            // different (or restarted) Desktop session before applying it.
            const sidecar = checkSidecar(worksheetFile, resolvedSession, 'worksheet');
            if (!sidecar.ok) {
              return new CacheSessionMismatchError(sidecar.message!).toErr();
            }
          }

          const executor = await extra.getExecutor(resolvedSession);
          let artifactReservation: TemplateArtifactReservation | undefined;
          let worksheetWindowXml: string | undefined;
          let expectedState: WorksheetApplyState | undefined;
          let artifactProvenance: string | undefined;
          let artifactMetadataTrust:
            | 'trusted-protected-or-dev'
            | 'untrusted-repository'
            | undefined;

          if (artifactMode) {
            const reserved = artifactStore.reserve(
              artifactId,
              templateArtifactSessionIdentity(resolvedSession, executor.desktopInstanceId),
            );
            if (!reserved.ok) {
              return new ArgsValidationError(
                'The template artifact is unavailable, expired, already used, currently in use, or belongs to another Desktop session. No workbook change was sent. Read the current workbook and build a new artifact if the worksheet is still wanted.',
              ).toErr();
            }
            artifactReservation = reserved.reservation;
            worksheetName = reserved.artifact.worksheetName;
            worksheetXml = reserved.artifact.worksheetXml;
            worksheetWindowXml = reserved.artifact.worksheetWindowXml;
            expectedState = reserved.artifact.expectedState;
            artifactProvenance = reserved.artifact.templateProvenance;
            artifactMetadataTrust = reserved.artifact.metadataTrust;

            if (
              expectedState.target.state === 'present' ||
              expectedState.targetWindow.state === 'present'
            ) {
              artifactStore.commit(reserved.reservation);
              return artifactApplyError(
                'not-dispatched',
                'This template artifact was discarded because it would replace an existing worksheet or window. The template path creates new worksheets only; choose a fresh unique worksheet title and construct a new artifact.',
              );
            }
          }

          const effectiveWorksheetName = worksheetName!;
          let result: Awaited<ReturnType<typeof loadWorksheetXml>>;
          try {
            result = await loadWorksheetXml({
              worksheetName: effectiveWorksheetName,
              xml: worksheetXml!,
              focus: { navigate: 'artifact', sheetName: effectiveWorksheetName },
              executor,
              signal: extra.signal,
              expectedState,
              worksheetWindowXml,
              // WHY: Manual apply is replace-only; artifacts own guarded net-new creation.
              requireExistingSheet: !artifactMode,
            });
          } catch (error) {
            if (artifactReservation !== undefined) {
              artifactStore.commit(artifactReservation);
              return artifactApplyError(
                'possibly-dispatched',
                'Template artifact apply failed unexpectedly; the artifact was consumed. Do not replay it. Inspect Tableau and establish the current workbook state before any further change.',
              );
            }
            throw error;
          }

          if (result.isErr()) {
            if (artifactMode) {
              if (
                result.error.type === 'execute-command-error' &&
                result.error.dispatchState === 'not-dispatched' &&
                result.error.retrySafe === true
              ) {
                const canRetry =
                  artifactReservation !== undefined && artifactStore.release(artifactReservation);
                return artifactApplyError(
                  'not-dispatched',
                  canRetry
                    ? 'Template artifact apply stopped before dispatch because the workbook could not be read. No workbook change was sent. Retry apply-worksheet with this artifactId, or build a fresh artifact from the current workbook.'
                    : 'Template artifact apply stopped before dispatch because the workbook could not be read. No workbook change was sent. Build a fresh artifact from the current workbook before retrying.',
                );
              }
              if (artifactReservation !== undefined) artifactStore.commit(artifactReservation);

              if (result.error.type === 'execute-command-error') {
                return artifactApplyError(
                  result.error.dispatchState === 'not-dispatched'
                    ? 'not-dispatched'
                    : 'possibly-dispatched',
                  `Template artifact apply outcome is uncertain (${result.error.error.type}); the artifact was consumed. Do not replay it. Inspect Tableau and establish the current workbook state before any further change.`,
                );
              }

              switch (result.error.error.type) {
                case 'invalid-xml':
                case 'name-mismatch':
                case 'preview-state-changed':
                case 'sheet-absent':
                  return artifactApplyError(
                    'not-dispatched',
                    'The template artifact was not applied because the workbook no longer matches its exact source state; the artifact was consumed. Read the current workbook and build a new artifact if the worksheet is still wanted.',
                  );
                case 'validation-failed':
                  return artifactApplyError(
                    'not-dispatched',
                    formatArtifactValidationFailure(result.error.error.issues),
                  );
                case 'load-rejected':
                  return artifactApplyError(
                    'possibly-dispatched',
                    'Tableau rejected the template artifact; no worksheet mutation was verified and the artifact was consumed. Inspect Tableau and establish the current workbook state before any further change.',
                  );
                case 'readback-failed':
                  return artifactApplyError(
                    'possibly-dispatched',
                    'The template artifact MAY already be applied, but post-apply verification failed. The artifact was consumed; do not replay it. Inspect Tableau and establish the current workbook state before any further change.',
                  );
              }
            }
            const { type, error } = result.error;
            switch (type) {
              case 'execute-command-error':
                return new DesktopCommandExecutionError(error).toErr();
              case 'load-worksheet-xml-error':
                return new WorksheetXmlLoadFailedError(error).toErr();
              default: {
                const _: never = type;
              }
            }
          }

          if (artifactReservation !== undefined) artifactStore.commit(artifactReservation);

          // Non-fatal post-apply readback warnings (e.g. a sort Tableau reshaped) ride
          // along so the agent can re-check the rendered chart before moving on (W4).
          const readbackWarning = result.isOk()
            ? artifactMode
              ? ''
              : formatReadbackVerificationWarnings(result.value.readbackWarnings)
            : '';
          // Host verification receipt (W-23447506) — subsumes the old readback
          // status sentence: one host-truth line, derived from preflight +
          // readback, never model-filled.
          const receiptInput = result.isOk()
            ? {
                validationWarnings: result.value.validationWarnings ?? [],
                readback: result.value.readbackVerification,
                readbackFindings: result.value.readbackWarnings,
              }
            : undefined;
          const promiseOutcome = receiptInput
            ? classifyWorksheetPromiseOutcome(receiptInput)
            : 'unverified';
          if (result.isOk()) {
            await emitWorksheetPromiseEvents({
              config: extra.config,
              sessionId: resolvedSession,
              tool: 'apply-worksheet',
              operation: 'load-worksheet',
              readback: result.value.readbackVerification,
              findings: result.value.readbackWarnings,
              promiseOutcome,
            });
          }
          if (artifactMode && promiseOutcome !== 'verified') {
            const verificationMessage =
              promiseOutcome === 'failed'
                ? 'The template artifact MAY already be applied, but host verification failed.'
                : 'The template artifact MAY already be applied, but host verification is unavailable.';
            return artifactApplyError(
              'possibly-dispatched',
              `${verificationMessage} The artifact was consumed; do not replay it. Inspect Tableau and establish the current workbook state before any further change.`,
            );
          }
          const receipt = receiptInput
            ? artifactMode
              ? `\n\nHOST VERIFICATION — ${promiseOutcome}. Template-derived readback detail is withheld from the model-visible artifact response; inspect Tableau directly before making a stronger claim.`
              : formatWorksheetPromiseCheck(receiptInput)
            : '';
          const validationWarningRuleIds =
            artifactMode && result.isOk()
              ? sanitizedValidationRuleIds(
                  (result.value.validationWarnings ?? []).filter(
                    (issue) => issue.severity !== 'error',
                  ),
                )
              : [];

          return new Ok({
            message: `Successfully applied worksheet update for "${effectiveWorksheetName}". The worksheet has been updated.${readbackWarning}${receipt}`,
            ...(artifactMode
              ? {
                  templateProvenance: artifactProvenance!,
                  metadataTrust: artifactMetadataTrust!,
                  ...(validationWarningRuleIds.length > 0 ? { validationWarningRuleIds } : {}),
                }
              : {}),
          });
        },
      });
    },
  });

  return applyWorksheetTool as unknown as ApplyWorksheetTool;
};
