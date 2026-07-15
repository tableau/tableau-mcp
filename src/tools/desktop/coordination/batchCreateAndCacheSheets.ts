import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { writeFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { DesktopCache } from '../../../desktop/cache.js';
import { writeSidecar } from '../../../desktop/commands/workbook/cacheFingerprint.js';
import { getDashboardXml } from '../../../desktop/commands/workbook/getDashboardXml.js';
import { getWorkbookXml } from '../../../desktop/commands/workbook/getWorkbookXml.js';
import { getWorksheetXml } from '../../../desktop/commands/workbook/getWorksheetXml.js';
import { loadWorkbookXml } from '../../../desktop/commands/workbook/loadWorkbookXml.js';
import { addDashboard, addSheet } from '../../../desktop/metadata/index.js';
import {
  checkRouteGateForScratchEntry,
  type RouteGateResult,
} from '../../../desktop/route/route-gate.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import {
  DesktopCommandExecutionError,
  WorkbookXmlLoadFailedError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
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

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  worksheetNames: z.array(z.string()).describe('Names of worksheets to create.'),
  dashboardName: z.string().describe('Name of dashboard to create.'),
};

const toolTitle = 'Batch Create Sheets and Cache Working Copies';
export const getBatchCreateAndCacheSheetsTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'batch-create-and-cache-sheets',
    title: toolTitle,
    description: [
      'Create multiple worksheet sheets and one dashboard in one operation, then cache all empty working copies.',
      'Phase 1 of the parallel dashboard creation workflow.',
      'Returns file paths for use in build-and-apply-worksheet and build-and-apply-dashboard.',
    ].join(' '),
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
          const worksheetWarnings: string[] = [];
          for (const name of worksheetNames) {
            const wsResult = await getWorksheetXml({ worksheetName: name, executor, signal });
            if (wsResult.isErr()) {
              const { type, error } = wsResult.error;
              if (type === 'get-worksheet-xml-error') {
                worksheetWarnings.push(`${name}: ${error.message}`);
              } else {
                worksheetWarnings.push(`${name}: command error`);
              }
              continue;
            }
            const safeWsName = name.replace(/[^a-zA-Z0-9]/g, '_');
            const file = cache.getCacheFilePath({ prefix: 'worksheet', id: safeWsName });
            writeFileSync(file, wsResult.value, 'utf-8');
            writeSidecar(file, resolvedSession);
            worksheetFiles[name] = file;
          }

          // Fetch and cache the dashboard working copy.
          let dashboardFile: string | null = null;
          const dashResult = await getDashboardXml({ dashboardName, executor, signal });
          if (dashResult.isErr()) {
            const { type, error } = dashResult.error;
            if (type === 'get-dashboard-xml-error') {
              worksheetWarnings.push(`dashboard "${dashboardName}": ${error.message}`);
            }
          } else {
            const safeDashName = dashboardName.replace(/[^a-zA-Z0-9]/g, '_');
            dashboardFile = cache.getCacheFilePath({ prefix: 'dashboard', id: safeDashName });
            writeFileSync(dashboardFile, dashResult.value, 'utf-8');
            writeSidecar(dashboardFile, resolvedSession);
          }

          const worksheetFileLines = Object.entries(worksheetFiles)
            .map(([name, file]) => `  ${name} → ${file}`)
            .join('\n');

          let msg = `Created and cached ${worksheetNames.length} worksheets + 1 dashboard\n\n`;
          msg += `Worksheets:\n${worksheetFileLines || '  (none cached)'}\n\n`;
          msg += `Dashboard:\n  ${dashboardName} → ${dashboardFile || 'FAILED'}\n\n`;
          msg += `Workbook cache: ${workbookFile}`;
          if (worksheetWarnings.length > 0) {
            msg += `\n\nWarnings:\n${worksheetWarnings.map((w) => `  • ${w}`).join('\n')}`;
          }
          msg += '\n\nReady for Phase 2 parallel execution.';

          return new Ok({
            message: msg,
            worksheetFiles,
            dashboardFile,
            workbookFile,
          });
        },
      });
    },
  });
  return tool;
};
