import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { checkSidecar } from '../../../desktop/commands/workbook/cacheFingerprint.js';
import { loadDashboardXml } from '../../../desktop/commands/workbook/loadDashboardXml.js';
import { currentEpisodeId, emitEpisodeEvent } from '../../../desktop/episode-events.js';
import {
  buildApplyOverCapNote,
  isOverInlineXmlCap,
  xmlByteLength,
} from '../../../desktop/inlineXmlCap.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { formatDashboardPromiseCheck } from '../../../desktop/validation/promise-check.js';
import {
  ArgsValidationError,
  CacheSessionMismatchError,
  DashboardXmlLoadFailedError,
  DesktopCommandExecutionError,
  FileReadError,
  WorkbookNotFoundError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().optional().describe(''),
  dashboardName: z.string().describe(''),
  mode: z
    .enum(['file', 'inline'])
    .optional()
    .default('file')
    .describe(''),
  dashboardFile: z.string().optional().describe(''),
  dashboardXml: z.string().optional().describe(''),
};

const title = 'Apply Dashboard';
export const getApplyDashboardTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const applyDashboardTool = new DesktopTool({
    server,
    name: 'apply-dashboard',
    title,
    description: [
      'Apply modified dashboard layout to Tableau.',
      'Updates existing dashboards only; use apply-workbook to create.',
    ].join(' '),
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    callback: async (
      { session, dashboardName, mode, dashboardFile, dashboardXml },
      extra,
    ): Promise<CallToolResult> => {
      return await applyDashboardTool.logAndExecute({
        extra,
        args: { session, dashboardName, mode, dashboardFile, dashboardXml },
        callback: async () => {
          switch (mode) {
            case 'inline': {
              if (!dashboardXml?.trim()) {
                return new ArgsValidationError(
                  'When mode=inline, non-empty dashboard layout content is required.',
                ).toErr();
              }
              break;
            }
            case 'file': {
              if (!dashboardFile?.trim()) {
                return new ArgsValidationError(
                  [
                    'When mode=file, a non-empty dashboard file path is required.',
                    'The path can be determined using the dashboard layout retrieval tool.',
                  ].join(' '),
                ).toErr();
              }

              if (!existsSync(dashboardFile)) {
                return new WorkbookNotFoundError(
                  [
                    `Cached dashboard file not found: ${dashboardFile}`,
                    'Provide a path determined by the dashboard layout retrieval tool.',
                  ].join(' '),
                ).toErr();
              }

              try {
                dashboardXml = readFileSync(dashboardFile, 'utf-8');
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
          if (mode === 'file' && dashboardFile) {
            const sidecar = checkSidecar(dashboardFile, resolvedSession, 'dashboard');
            if (!sidecar.ok) {
              return new CacheSessionMismatchError(sidecar.message!).toErr();
            }
          }

          const executor = await extra.getExecutor(resolvedSession);
          const result = await loadDashboardXml({
            dashboardName,
            xml: dashboardXml,
            executor,
            signal: extra.signal,
          });

          if (result.isErr()) {
            const { type, error } = result.error;
            switch (type) {
              case 'execute-command-error':
                return new DesktopCommandExecutionError(error).toErr();
              case 'load-dashboard-xml-error':
                return new DashboardXmlLoadFailedError(error).toErr();
              default: {
                const _: never = type;
              }
            }
          }

          const capBytes = extra.config.inlineXmlMaxBytes;
          const inlineBytes = mode === 'inline' ? xmlByteLength(dashboardXml ?? '') : 0;
          const note =
            mode === 'inline' && isOverInlineXmlCap(inlineBytes, capBytes)
              ? `\n\n${buildApplyOverCapNote(inlineBytes, capBytes)}`
              : '';

          // Host verification receipt (W-23447506): dashboard applies have no
          // structural readback, so say so honestly instead of implying full
          // re-verification happened.
          const receipt = result.isOk()
            ? formatDashboardPromiseCheck(result.value.validationWarnings)
            : '';
          if (result.isOk()) {
            await emitEpisodeEvent(extra.config, {
              type: 'apply_succeeded',
              session_id: resolvedSession,
              episode_id: currentEpisodeId(resolvedSession),
              tool: 'apply-dashboard',
              operation: 'load-dashboard',
              promise_outcome: 'unverified',
            });
          }

          return new Ok({
            message: `Successfully applied dashboard update for "${dashboardName}". The dashboard has been updated.${note}${receipt}`,
          });
        },
      });
    },
  });

  return applyDashboardTool;
};
