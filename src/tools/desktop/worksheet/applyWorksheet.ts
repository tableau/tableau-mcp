import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { checkSidecar } from '../../../desktop/commands/workbook/cacheFingerprint.js';
import { loadWorksheetXml } from '../../../desktop/commands/workbook/loadWorksheetXml.js';
import { emitWorksheetPromiseEvents } from '../../../desktop/episode-events.js';
import {
  buildApplyOverCapNote,
  isOverInlineXmlCap,
  xmlByteLength,
} from '../../../desktop/inlineXmlCap.js';
import { worksheetApplyStateSchema } from '../../../desktop/metadata/targetWorksheetState.js';
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
  WorksheetNotFoundError,
  WorksheetXmlLoadFailedError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  artifactId: z.string().uuid().optional().describe('One-shot id from template build.'),
  session: z.string().max(64).optional(),
  worksheetName: z.string().min(1).max(255).optional(),
  mode: z.enum(['file', 'inline']).optional(),
  worksheetFile: z.string().max(4096).optional(),
  worksheetXml: z.string().optional(),
  worksheetWindowXml: z.string().optional().describe('Optional worksheet window.'),
  expectedState: worksheetApplyStateSchema.optional().describe('Build-time worksheet state guard.'),
};

const title = 'Apply Worksheet';

function formatArtifactValidationFailure(issues: ValidationIssue[]): string {
  if (issues.some((issue) => issue.ruleId === 'connections-not-authorable')) {
    return (
      'Template artifact preflight failed (connections-not-authorable); no workbook change was sent. ' +
      "Add or repair the connection in Desktop's Connect pane, then retry this same unexpired artifact once."
    );
  }
  const ruleIds = [
    ...new Set(
      issues
        .map((issue) => issue.ruleId.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 80))
        .filter(Boolean),
    ),
  ].slice(0, 5);
  const finding = ruleIds.length > 0 ? ` (${ruleIds.join(', ')})` : '';
  return (
    `Template artifact preflight failed${finding}; no workbook change was sent. ` +
    'Resolve the reported workbook issue, then retry this same unexpired artifact once.'
  );
}
export const getApplyWorksheetTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const artifactStore = getTemplateArtifactStore(server);
  const applyWorksheetTool = new DesktopTool({
    server,
    name: 'apply-worksheet',
    title,
    description:
      'Insert or entirely replace (upsert) a worksheet in the live workbook, matched by name.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: false, // updates worksheet in workbook
      openWorldHint: false,
      destructiveHint: true, // updates active workbook
      idempotentHint: false,
    },
    callback: async (
      {
        artifactId,
        session,
        worksheetName,
        mode,
        worksheetFile,
        worksheetXml,
        worksheetWindowXml,
        expectedState,
      },
      extra,
    ): Promise<CallToolResult> => {
      return await applyWorksheetTool.logAndExecute({
        extra,
        args: {
          artifactId,
          session,
          worksheetName,
          mode,
          worksheetFile,
          worksheetXml,
          worksheetWindowXml,
          expectedState,
        },
        callback: async () => {
          const artifactMode = artifactId !== undefined;
          if (
            artifactMode &&
            (mode !== undefined ||
              worksheetName !== undefined ||
              worksheetFile !== undefined ||
              worksheetXml !== undefined ||
              worksheetWindowXml !== undefined ||
              expectedState !== undefined)
          ) {
            return new ArgsValidationError(
              'artifactId cannot be combined with worksheetName, mode, worksheetFile, worksheetXml, worksheetWindowXml, or expectedState. Rebuild the artifact if different content is needed.',
            ).toErr();
          }

          const effectiveMode = mode ?? 'file';
          if (!artifactMode && !worksheetName?.trim()) {
            return new ArgsValidationError(
              'A non-empty worksheetName is required when artifactId is not provided.',
            ).toErr();
          }

          switch (artifactMode ? undefined : effectiveMode) {
            case 'inline': {
              if (!worksheetXml?.trim()) {
                return new ArgsValidationError(
                  'When mode=inline, non-empty worksheet content is required.',
                ).toErr();
              }
              break;
            }
            case 'file': {
              if (!worksheetFile?.trim()) {
                return new ArgsValidationError(
                  [
                    'When mode=file, a non-empty worksheet file path is required.',
                    'The path can be determined using the worksheet structure retrieval tool.',
                  ].join(' '),
                ).toErr();
              }

              if (!existsSync(worksheetFile)) {
                return new WorksheetNotFoundError(
                  [
                    `Cached worksheet file not found: ${worksheetFile}`,
                    'Provide a path determined by the worksheet structure retrieval tool.',
                  ].join(' '),
                ).toErr();
              }

              try {
                worksheetXml = readFileSync(worksheetFile, 'utf-8');
              } catch (error) {
                return new FileReadError(error).toErr();
              }
              break;
            }
          }

          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;

          // Cross-instance cache-bleed guard (W9): refuse a cache file produced by a
          // different (or restarted) Desktop session before applying it — file mode only,
          // since inline content carries no cache fingerprint.
          if (!artifactMode && effectiveMode === 'file' && worksheetFile) {
            const sidecar = checkSidecar(worksheetFile, resolvedSession, 'worksheet');
            if (!sidecar.ok) {
              return new CacheSessionMismatchError(sidecar.message!).toErr();
            }
          }

          const executor = await extra.getExecutor(resolvedSession);
          let artifactProvenance: string | undefined;
          let artifactMetadataTrust:
            | 'trusted-protected-or-dev'
            | 'untrusted-repository'
            | undefined;
          let artifactReservation: TemplateArtifactReservation | undefined;
          if (artifactMode) {
            const reserved = artifactStore.reserve(
              artifactId,
              templateArtifactSessionIdentity(resolvedSession, executor.desktopInstanceId),
            );
            if (!reserved.ok) {
              return new ArgsValidationError(
                'The template artifact is unavailable, expired, already used, currently in use, or belongs to another Desktop session. Do not rebuild or retry automatically; inspect and report the current workbook state, then rebuild from the still-current agreed inputs only on a later user request if it is still wanted.',
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
              return new ArgsValidationError(
                'This template artifact was discarded because it would replace an existing worksheet or window. The template path creates new worksheets only; choose a fresh unique worksheet title and construct a new artifact.',
              ).toErr();
            }
          }
          let result: Awaited<ReturnType<typeof loadWorksheetXml>>;
          try {
            result = await loadWorksheetXml({
              worksheetName: worksheetName!,
              xml: worksheetXml!,
              executor,
              signal: extra.signal,
              expectedState,
              worksheetWindowXml,
            });
          } catch (error) {
            if (artifactReservation !== undefined) artifactStore.commit(artifactReservation);
            throw error;
          }

          if (result.isErr()) {
            if (artifactMode) {
              const safeValidationFailure =
                result.error.type === 'load-worksheet-xml-error' &&
                result.error.error.type === 'validation-failed';
              if (artifactReservation !== undefined) {
                if (safeValidationFailure) artifactStore.release(artifactReservation);
                else artifactStore.commit(artifactReservation);
              }
              if (result.error.type === 'execute-command-error') {
                return new ArgsValidationError(
                  `Template artifact apply outcome is uncertain (${result.error.error.type}). Do not rebuild or retry automatically; inspect Tableau and report the current workbook state, then rebuild from the still-current agreed inputs only on a later user request if it is still wanted.`,
                ).toErr();
              }
              switch (result.error.error.type) {
                case 'invalid-xml':
                case 'name-mismatch':
                case 'preview-state-changed':
                  return new ArgsValidationError(
                    'The template artifact was not applied because it no longer matches the current workbook state. Do not rebuild or retry automatically; inspect and report the current workbook state, then rebuild from the still-current agreed inputs only on a later user request if it is still wanted.',
                  ).toErr();
                case 'validation-failed':
                  return new ArgsValidationError(
                    formatArtifactValidationFailure(result.error.error.issues),
                  ).toErr();
                case 'load-rejected':
                  return new ArgsValidationError(
                    'Tableau rejected the template artifact; no worksheet mutation was verified. Do not rebuild or retry automatically; inspect Tableau and report the current workbook state, then rebuild from the still-current agreed inputs only on a later user request if it is still wanted.',
                  ).toErr();
                case 'readback-failed':
                  return new ArgsValidationError(
                    'The template artifact MAY already be applied, but post-apply verification failed. Inspect Tableau and report only the verified workbook state. Do not replay the consumed artifact or automatically rebuild it; a fresh build requires a later explicit user request.',
                  ).toErr();
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

          const capBytes = extra.config.inlineXmlMaxBytes;
          const inlineBytes =
            !artifactMode && effectiveMode === 'inline'
              ? xmlByteLength(worksheetXml ?? '') + xmlByteLength(worksheetWindowXml ?? '')
              : 0;
          const note =
            !artifactMode && effectiveMode === 'inline' && isOverInlineXmlCap(inlineBytes, capBytes)
              ? `\n\n${buildApplyOverCapNote(inlineBytes, capBytes)}`
              : '';

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
            return new ArgsValidationError(
              `${verificationMessage} Inspect Tableau and report only the verified workbook state. Do not replay the consumed artifact or automatically rebuild it; a fresh build requires a later explicit user request.`,
            ).toErr();
          }
          const receipt = receiptInput
            ? artifactMode
              ? `\n\nHOST VERIFICATION — ${promiseOutcome}. Template-derived readback detail is withheld from the model-visible artifact response; inspect Tableau directly before making a stronger claim.`
              : formatWorksheetPromiseCheck(receiptInput)
            : '';

          return new Ok({
            message: `Successfully applied worksheet update for "${worksheetName}". The worksheet has been updated.${note}${readbackWarning}${receipt}`,
            ...(artifactMode
              ? {
                  templateProvenance: artifactProvenance!,
                  metadataTrust: artifactMetadataTrust!,
                }
              : {}),
          });
        },
      });
    },
  });

  return applyWorksheetTool;
};
