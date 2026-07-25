import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { checkSidecar } from '../../../desktop/commands/workbook/cacheFingerprint.js';
import { loadDashboardXml } from '../../../desktop/commands/workbook/loadDashboardXml.js';
import { currentEpisodeId, emitEpisodeEvent } from '../../../desktop/episode-events.js';
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
  session: z.string().optional(),
  dashboardName: z.string(),
  dashboardFile: z.string().optional(),
};

const title = 'Apply Dashboard';
export const getApplyDashboardTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const applyDashboardTool = new DesktopTool({
    server,
    name: 'apply-dashboard',
    title,
    description: 'Apply modified dashboard layout to Tableau.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    callback: async ({ session, dashboardName, dashboardFile }, extra): Promise<CallToolResult> => {
      return await applyDashboardTool.logAndExecute({
        extra,
        args: { session, dashboardName, dashboardFile },
        callback: async () => {
          // No inline document parameter: the cached file path IS the handle. Making the
          // model retype a document cost ~190s of pure emission across six asks, and
          // inline content carried no cache fingerprint, so it also skipped the
          // cross-instance bleed guard below.
          if (!dashboardFile?.trim()) {
            return new ArgsValidationError(
              [
                'A non-empty dashboard file path is required.',
                'Get one from the dashboard structure retrieval tool, edit it with the cache',
                'read/write tools, then pass that path here.',
              ].join(' '),
            ).toErr();
          }

          if (!existsSync(dashboardFile)) {
            return new WorkbookNotFoundError(
              [
                `Cached dashboard file not found: ${dashboardFile}`,
                'Provide a path determined by the dashboard structure retrieval tool.',
              ].join(' '),
            ).toErr();
          }

          let dashboardXml: string;
          try {
            dashboardXml = readFileSync(dashboardFile, 'utf-8');
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
          const sidecar = checkSidecar(dashboardFile, resolvedSession, 'dashboard');
          if (!sidecar.ok) {
            return new CacheSessionMismatchError(sidecar.message!).toErr();
          }

          const executor = await extra.getExecutor(resolvedSession);
          const result = await loadDashboardXml({
            dashboardName,
            xml: dashboardXml,
            focus: { navigate: 'artifact', sheetName: dashboardName },
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
            message: `Successfully applied dashboard update for "${dashboardName}". The dashboard has been updated.${receipt}`,
          });
        },
      });
    },
  });

  return applyDashboardTool;
};
