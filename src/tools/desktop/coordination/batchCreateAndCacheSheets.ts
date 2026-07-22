import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { writeFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { DesktopCache } from '../../../desktop/cache.js';
import { writeSidecar } from '../../../desktop/commands/workbook/cacheFingerprint.js';
import { getDashboardFragment } from '../../../desktop/commands/workbook/getDashboardXml.js';
import { getWorkbookXml } from '../../../desktop/commands/workbook/getWorkbookXml.js';
import { getWorksheetFragment } from '../../../desktop/commands/workbook/getWorksheetXml.js';
import { loadWorkbookXml } from '../../../desktop/commands/workbook/loadWorkbookXml.js';
import { currentEpisodeId, emitEpisodeEvent } from '../../../desktop/episode-events.js';
import { addDashboard, addSheet } from '../../../desktop/metadata/index.js';
import {
  checkRouteGateForScratchEntry,
  type RouteGateResult,
} from '../../../desktop/route/route-gate.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { formatWorkbookPromiseCheck } from '../../../desktop/validation/promise-check.js';
import {
  DesktopCommandExecutionError,
  WorkbookXmlLoadFailedError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { IncompleteOperationError } from '../incompleteOperationError.js';
import { DesktopTool } from '../tool.js';

function isRouteGateResult(result: unknown): result is RouteGateResult {
  return (
    typeof result === 'object' &&
    result !== null &&
    Array.isArray((result as { content?: unknown }).content) &&
    typeof (result as { isError?: unknown }).isError === 'boolean'
  );
}

function getSuccessResult(result: unknown): CallToolResult {
  if (isRouteGateResult(result)) return result;
  return {
    isError: false,
    content: [{ type: 'text', text: JSON.stringify(result) }],
  };
}

type ArtifactFailure = { name: string; error: string };

function fragmentFailureMessage(error: { type: string; error: unknown }): string {
  if (
    typeof error.error === 'object' &&
    error.error !== null &&
    'message' in error.error &&
    typeof error.error.message === 'string'
  ) {
    return error.error.message;
  }
  return `${error.type}: ${JSON.stringify(error.error)}`;
}

const paramsSchema = {
  session: z.string().optional(),
  worksheetNames: z.array(z.string()),
  dashboardName: z.string(),
};

const toolTitle = 'Batch Create Sheets and Cache Working Copies';
export const getBatchCreateAndCacheSheetsTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'batch-create-and-cache-sheets',
    title: toolTitle,
    description: 'Batch-create dashboard sheet caches.',
    paramsSchema,
    annotations: {
      title: toolTitle,
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    callback: async (
      { session, worksheetNames, dashboardName },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { session, worksheetNames, dashboardName },
        getSuccessResult,
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;

          const gateResult = checkRouteGateForScratchEntry(
            'batch-create-and-cache-sheets',
            resolvedSession,
          );
          if (gateResult) {
            return new Ok(gateResult);
          }

          const executor = await extra.getExecutor(resolvedSession);
          const signal = extra.signal;
          const cache = new DesktopCache(resolvedSession);

          // Fetch current workbook
          const workbookResult = await getWorkbookXml({ executor, signal });
          if (workbookResult.isErr()) {
            return new DesktopCommandExecutionError(workbookResult.error).toErr();
          }
          let workbookXml = workbookResult.value;

          // Add worksheets and dashboard to workbook XML
          for (const name of worksheetNames) {
            workbookXml = addSheet(workbookXml, name);
          }
          workbookXml = addDashboard(workbookXml, dashboardName);

          // Apply modified workbook
          const applyResult = await loadWorkbookXml({ xml: workbookXml, executor, signal });
          if (applyResult.isErr()) {
            const { type, error } = applyResult.error;
            switch (type) {
              case 'execute-command-error':
                return new DesktopCommandExecutionError(error).toErr();
              case 'load-workbook-xml-error':
                return new WorkbookXmlLoadFailedError(error).toErr();
              default: {
                const _exhaustive: never = type;
              }
            }
          }

          // Cache workbook
          const workbookFile = cache.getCacheFilePath({
            prefix: 'workbook',
            id: 'for-parallel-build',
          });
          writeFileSync(workbookFile, workbookXml, 'utf-8');
          // Fingerprint the cache with the producing Desktop instance so a Phase-2 apply
          // can refuse a cache from a different (or restarted) Desktop session (W9).
          writeSidecar(workbookFile, resolvedSession);

          // Fetch and cache all worksheet working copies.
          const worksheetFiles: Record<string, string> = {};
          const worksheetFailures: ArtifactFailure[] = [];
          for (const name of worksheetNames) {
            const wsResult = await getWorksheetFragment({ worksheetName: name, executor, signal });
            if (wsResult.isErr()) {
              worksheetFailures.push({
                name,
                error: fragmentFailureMessage(wsResult.error),
              });
              continue;
            }
            const safeWsName = name.replace(/[^a-zA-Z0-9]/g, '_');
            const file = cache.getCacheFilePath({ prefix: 'worksheet', id: safeWsName });
            try {
              writeFileSync(file, wsResult.value, 'utf-8');
            } catch (error) {
              worksheetFailures.push({
                name,
                error: `cache write failed: ${getExceptionMessage(error)}`,
              });
              continue;
            }
            writeSidecar(file, resolvedSession);
            worksheetFiles[name] = file;
          }

          // Fetch and cache the dashboard working copy.
          let dashboardFile: string | null = null;
          const dashboardFailures: ArtifactFailure[] = [];
          const dashResult = await getDashboardFragment({ dashboardName, executor, signal });
          if (dashResult.isErr()) {
            dashboardFailures.push({
              name: dashboardName,
              error: fragmentFailureMessage(dashResult.error),
            });
          } else {
            const safeDashName = dashboardName.replace(/[^a-zA-Z0-9]/g, '_');
            const file = cache.getCacheFilePath({ prefix: 'dashboard', id: safeDashName });
            try {
              writeFileSync(file, dashResult.value, 'utf-8');
              writeSidecar(file, resolvedSession);
              dashboardFile = file;
            } catch (error) {
              dashboardFailures.push({
                name: dashboardName,
                error: `cache write failed: ${getExceptionMessage(error)}`,
              });
            }
          }

          const worksheetFileLines = Object.entries(worksheetFiles)
            .map(([name, file]) => `  ${name} → ${file}`)
            .join('\n');

          const hasArtifactFailures = worksheetFailures.length > 0 || dashboardFailures.length > 0;
          let msg = hasArtifactFailures
            ? `Phase 1 incomplete: cached ${Object.keys(worksheetFiles).length}/${worksheetNames.length} worksheets and ${dashboardFile ? '1/1' : '0/1'} dashboard.\n\n`
            : `Created and cached ${worksheetNames.length} worksheets + 1 dashboard\n\n`;
          msg += `Worksheets:\n${worksheetFileLines || '  (none cached)'}\n\n`;
          msg += `Dashboard:\n  ${dashboardName} → ${dashboardFile || 'FAILED'}\n\n`;
          msg += `Workbook cache: ${workbookFile}`;
          const failures = [...worksheetFailures, ...dashboardFailures];
          if (failures.length > 0) {
            msg += `\n\nFailed required artifacts:\n${failures
              .map((failure) => `  • ${failure.name}: ${failure.error}`)
              .join('\n')}`;
          }
          msg += hasArtifactFailures
            ? '\n\nPhase 2 is not ready. Retry the failed fetch/cache steps before continuing.'
            : '\n\nReady for Phase 2 parallel execution.';
          // Host verification receipt (W-23447506): this whole-workbook apply has
          // no structural readback, so say so honestly instead of implying full
          // re-verification happened.
          msg += applyResult.isOk()
            ? formatWorkbookPromiseCheck(applyResult.value.validationWarnings)
            : '';
          if (applyResult.isOk()) {
            await emitEpisodeEvent(extra.config, {
              type: 'apply_succeeded',
              session_id: resolvedSession,
              episode_id: currentEpisodeId(resolvedSession),
              tool: 'batch-create-and-cache-sheets',
              operation: 'load-workbook',
              promise_outcome: 'unverified',
            });
          }

          const payload = {
            message: msg,
            worksheetFiles,
            dashboardFile,
            workbookFile,
          };
          if (hasArtifactFailures) {
            return new IncompleteOperationError({
              ...payload,
              succeeded: {
                worksheets: Object.keys(worksheetFiles),
                dashboard: dashboardFile ? [dashboardName] : [],
              },
              failed: {
                worksheets: worksheetFailures,
                dashboard: dashboardFailures,
              },
              guidance:
                'Do not start Phase 2 while required cache files are missing. Retry Phase 1 after resolving the named fetch/cache failures.',
            }).toErr();
          }
          return new Ok(payload);
        },
      });
    },
  });
  return tool;
};
