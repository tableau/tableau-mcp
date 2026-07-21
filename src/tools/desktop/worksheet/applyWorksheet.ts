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
import { resolveSession } from '../../../desktop/sessionResolution.js';
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
  WorksheetNotFoundError,
  WorksheetXmlLoadFailedError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().optional(),
  worksheetName: z.string(),
  mode: z.enum(['file', 'inline']).optional().default('file'),
  worksheetFile: z.string().optional(),
  worksheetXml: z.string().optional(),
};

const title = 'Apply Worksheet';
export const getApplyWorksheetTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const applyWorksheetTool = new DesktopTool({
    server,
    name: 'apply-worksheet',
    title,
    description: 'Apply modified worksheet content to Tableau.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: false, // updates worksheet in workbook
      openWorldHint: false,
      destructiveHint: true, // updates active workbook
      idempotentHint: false,
    },
    callback: async (
      { session, worksheetName, mode, worksheetFile, worksheetXml },
      extra,
    ): Promise<CallToolResult> => {
      return await applyWorksheetTool.logAndExecute({
        extra,
        args: { session, worksheetName, mode, worksheetFile, worksheetXml },
        callback: async () => {
          switch (mode) {
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
          if (mode === 'file' && worksheetFile) {
            const sidecar = checkSidecar(worksheetFile, resolvedSession, 'worksheet');
            if (!sidecar.ok) {
              return new CacheSessionMismatchError(sidecar.message!).toErr();
            }
          }

          const executor = await extra.getExecutor(resolvedSession);
          const result = await loadWorksheetXml({
            worksheetName,
            xml: worksheetXml,
            executor,
            signal: extra.signal,
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

          const capBytes = extra.config.inlineXmlMaxBytes;
          const inlineBytes = mode === 'inline' ? xmlByteLength(worksheetXml ?? '') : 0;
          const note =
            mode === 'inline' && isOverInlineXmlCap(inlineBytes, capBytes)
              ? `\n\n${buildApplyOverCapNote(inlineBytes, capBytes)}`
              : '';

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
            message: `Successfully applied worksheet update for "${worksheetName}". The worksheet has been updated.${note}${readbackWarning}${receipt}`,
          });
        },
      });
    },
  });

  return applyWorksheetTool;
};
