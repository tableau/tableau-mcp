import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { checkSidecar } from '../../../desktop/commands/workbook/cacheFingerprint.js';
import { loadWorkbookXml } from '../../../desktop/commands/workbook/loadWorkbookXml.js';
import { currentEpisodeId, emitEpisodeEvent } from '../../../desktop/episode-events.js';
import {
  buildApplyOverCapNote,
  isOverInlineXmlCap,
  xmlByteLength,
} from '../../../desktop/inlineXmlCap.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { formatWorkbookPromiseCheck } from '../../../desktop/validation/promise-check.js';
import {
  ArgsValidationError,
  CacheSessionMismatchError,
  DesktopCommandExecutionError,
  FileReadError,
  WorkbookNotFoundError,
  WorkbookXmlLoadFailedError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().optional().describe(''),
  mode: z.enum(['file', 'inline']).optional().default('file').describe(''),
  workbookFile: z.string().optional().describe(''),
  workbookXml: z.string().optional().describe(''),
};

const title = 'Apply Workbook';
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
      title,
      readOnlyHint: false, // writes cache files and updates workbook
      openWorldHint: false,
      destructiveHint: true, // updates active workbook
      idempotentHint: false, // each call creates a new cache file
    },
    callback: async (
      { session, mode, workbookFile, workbookXml },
      extra,
    ): Promise<CallToolResult> => {
      return await applyWorkbookTool.logAndExecute({
        extra,
        args: { session, mode, workbookFile, workbookXml },
        callback: async () => {
          switch (mode) {
            case 'inline': {
              if (!workbookXml?.trim()) {
                return new ArgsValidationError(
                  'When mode=inline, non-empty workbook content is required.',
                ).toErr();
              }
              break;
            }
            case 'file': {
              if (!workbookFile?.trim()) {
                return new ArgsValidationError(
                  [
                    'When mode=file, a non-empty workbook file path is required.',
                    'The path can be determined using any of the tools that get or modify workbook content.',
                  ].join(' '),
                ).toErr();
              }

              if (!existsSync(workbookFile)) {
                return new WorkbookNotFoundError(
                  [
                    `Cached workbook file not found: ${workbookFile}`,
                    'Provide a path determined by any of the tools that get or modify workbook content.',
                  ].join(' '),
                ).toErr();
              }

              try {
                workbookXml = readFileSync(workbookFile, 'utf-8');
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
          if (mode === 'file' && workbookFile) {
            const sidecar = checkSidecar(workbookFile, resolvedSession, 'workbook');
            if (!sidecar.ok) {
              return new CacheSessionMismatchError(sidecar.message!).toErr();
            }
          }

          const executor = await extra.getExecutor(resolvedSession);
          const result = await loadWorkbookXml({
            xml: workbookXml,
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
                const _: never = type;
              }
            }
          }

          // Applies are never rejected on size; if an inline payload was over the cap, just
          // point at the cheaper file-mode workflow for next time (the token win is on GET).
          const capBytes = extra.config.inlineXmlMaxBytes;
          const inlineBytes = mode === 'inline' ? xmlByteLength(workbookXml ?? '') : 0;
          const note =
            mode === 'inline' && isOverInlineXmlCap(inlineBytes, capBytes)
              ? `\n\n${buildApplyOverCapNote(inlineBytes, capBytes)}`
              : '';

          // Host verification receipt (W-23447506): whole-workbook applies have
          // no structural readback, so say so honestly instead of implying
          // full re-verification happened.
          const receipt = result.isOk()
            ? formatWorkbookPromiseCheck(result.value.validationWarnings)
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

          return new Ok({
            message: `Successfully applied workbook update. The workbook has been updated.${note}${receipt}`,
          });
        },
      });
    },
  });

  return applyWorkbookTool;
};
