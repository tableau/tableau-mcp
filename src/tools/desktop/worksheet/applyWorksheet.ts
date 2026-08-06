import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { Ok, type Result } from 'ts-results-es';
import { z } from 'zod';

import { checkSidecar } from '../../../desktop/commands/workbook/cacheFingerprint.js';
import { loadWorksheetXml } from '../../../desktop/commands/workbook/loadWorksheetXml.js';
import { emitWorksheetPromiseEvents } from '../../../desktop/episode-events.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import {
  getTemplateArtifactStore,
  type TemplateArtifactStore,
  type TemplateArtifactUnavailableReason,
} from '../../../desktop/templates/templateArtifactStore.js';
import {
  classifyWorksheetPromiseOutcome,
  formatWorksheetPromiseCheck,
} from '../../../desktop/validation/promise-check.js';
import { formatReadbackVerificationWarnings } from '../../../desktop/validation/readback-verify.js';
import {
  ArgsValidationError,
  CacheSessionMismatchError,
  DesktopCommandExecutionError,
  FileReadError,
  McpToolError,
  WorksheetNotFoundError,
  WorksheetXmlLoadFailedError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().optional(),
  artifactId: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .optional()
    .describe('Template artifact ID; omit for cached-file apply.'),
  worksheetName: z
    .string()
    .optional()
    .describe('Existing worksheet name for cached-file apply; omit with artifactId.'),
  worksheetFile: z
    .string()
    .optional()
    .describe('Cached worksheet path for manual apply; omit with artifactId.'),
};

function artifactUnavailableMessage(
  artifactId: string,
  reason: TemplateArtifactUnavailableReason,
): string {
  switch (reason) {
    case 'in-use':
      return `Template artifact "${artifactId}" is already being applied.`;
    case 'session-mismatch':
      return `Template artifact "${artifactId}" belongs to a different Desktop session.`;
    case 'consumed':
      return `Template artifact "${artifactId}" was already consumed. Build a fresh artifact.`;
    case 'evicted':
      return `Template artifact "${artifactId}" was evicted. Build a fresh artifact.`;
    case 'unknown':
      return `Template artifact "${artifactId}" is not available.`;
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

const title = 'Updating worksheet';

type ApplyWorksheetResult =
  | { message: string }
  | {
      artifactId: string;
      title: string;
      applied: true;
      retrySafe: false;
      verification: {
        ok: boolean;
        status: 'passed' | 'warning' | 'failed' | 'skipped';
        message?: string;
      };
    };

export const getApplyWorksheetTool = (
  server: DesktopMcpServer,
  dependencies: { store?: TemplateArtifactStore } = {},
): DesktopTool<typeof paramsSchema> => {
  const artifactStore = dependencies.store ?? getTemplateArtifactStore(server);
  const applyWorksheetTool = new DesktopTool({
    server,
    name: 'apply-worksheet',
    title,
    description: 'Apply a template artifact or a modified cached worksheet file to Desktop.',
    paramsSchema,
    annotations: {
      readOnlyHint: false, // updates worksheet in workbook
      openWorldHint: false,
      destructiveHint: true, // updates active workbook
      idempotentHint: false,
    },
    callback: async (
      { session, artifactId, worksheetName, worksheetFile },
      extra,
    ): Promise<CallToolResult> => {
      return await applyWorksheetTool.logAndExecute({
        extra,
        args: { session, artifactId, worksheetName, worksheetFile },
        callback: async (): Promise<Result<ApplyWorksheetResult, McpToolError>> => {
          if (artifactId) {
            if (worksheetName !== undefined || worksheetFile !== undefined) {
              return new ArgsValidationError(
                'artifactId cannot be combined with worksheetName or worksheetFile.',
              ).toErr();
            }
            const sessionResult = resolveSession(session);
            if (sessionResult.isErr()) return sessionResult.error.toErr();
            const resolvedSession = sessionResult.value;
            const reservation = artifactStore.reserve(artifactId, resolvedSession);
            if (!reservation.ok) {
              return new McpToolError({
                type: 'template-artifact-unavailable',
                message: artifactUnavailableMessage(artifactId, reservation.reason),
                statusCode: 409,
              }).toErr();
            }

            const dispatchState = { attempted: false };
            let finalized = false;
            const finalize = (): void => {
              if (finalized) return;
              finalized = true;
              if (dispatchState.attempted) artifactStore.consume(reservation.lease);
              else artifactStore.release(reservation.lease);
            };
            try {
              const executor = await extra.getExecutor(resolvedSession);
              const result = await loadWorksheetXml({
                worksheetName: reservation.artifact.title,
                xml: reservation.artifact.worksheetXml,
                focus: { navigate: 'artifact', sheetName: reservation.artifact.title },
                executor,
                signal: extra.signal,
                artifactApply: {
                  windowXml: reservation.artifact.windowXml,
                  expectedTargetState: reservation.artifact.targetState,
                  expectedInstanceId: reservation.artifact.instanceId,
                  dispatchState,
                },
              });
              finalize();

              if (result.isErr()) {
                const { type, error } = result.error;
                if (type === 'execute-command-error') {
                  return new DesktopCommandExecutionError(
                    error,
                    dispatchState.attempted
                      ? 'The artifact may have reached Desktop and was consumed. Do not retry it; build a fresh artifact after inspecting the workbook.'
                      : undefined,
                  ).toErr();
                }
                return new WorksheetXmlLoadFailedError(error).toErr();
              }

              return Ok({
                artifactId,
                title: reservation.artifact.title,
                applied: true,
                retrySafe: false,
                verification: result.value.readbackVerification ?? {
                  ok: true,
                  status: 'skipped',
                  message: 'Post-apply workbook readback was unavailable.',
                },
              });
            } catch (error) {
              finalize();
              throw error;
            }
          }

          if (!worksheetName?.trim()) {
            return new ArgsValidationError(
              'A worksheetName is required when applying a cached worksheet file.',
            ).toErr();
          }
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

          let worksheetXml: string;
          try {
            worksheetXml = readFileSync(worksheetFile, 'utf-8');
          } catch (error) {
            return new FileReadError(error).toErr();
          }

          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;

          // Cross-instance cache-bleed guard (W9): refuse a cache file produced by a
          // different (or restarted) Desktop session before applying it. Now that every
          // apply goes through a cache file, no payload can skip this check.
          const sidecar = checkSidecar(worksheetFile, resolvedSession, 'worksheet');
          if (!sidecar.ok) {
            return new CacheSessionMismatchError(sidecar.message!).toErr();
          }

          const executor = await extra.getExecutor(resolvedSession);
          const result = await loadWorksheetXml({
            worksheetName,
            xml: worksheetXml,
            focus: { navigate: 'artifact', sheetName: worksheetName },
            executor,
            signal: extra.signal,
            // apply-worksheet updates an existing worksheet in place via the per-sheet `/document`
            // route; a name that does not resolve surfaces as an error rather than creating a sheet
            // through the whole-workbook path (build-and-apply-worksheet owns net-new creation).
            requireExistingSheet: true,
          });

          if (result.isErr()) {
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

          // Non-fatal post-apply readback warnings (e.g. a sort Tableau reshaped) ride
          // along so the agent can re-check the rendered chart before moving on (W4).
          const readbackWarning = result.isOk()
            ? formatReadbackVerificationWarnings(result.value.readbackWarnings)
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
          const receipt = receiptInput ? formatWorksheetPromiseCheck(receiptInput) : '';

          return new Ok({
            message: `Successfully applied worksheet update for "${worksheetName}". The worksheet has been updated.${readbackWarning}${receipt}`,
          });
        },
      });
    },
  });

  return applyWorksheetTool;
};
