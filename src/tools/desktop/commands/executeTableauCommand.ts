import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { validateKnownCommand } from '../../../desktop/commandRegistry.js';
import { getWorkbookXml } from '../../../desktop/commands/workbook/getWorkbookXml.js';
import {
  findAllWorksheets,
  findWorksheet,
  normalizeArray,
  parseXML,
} from '../../../desktop/metadata/parser.js';
import type {
  ParsedPane,
  ParsedWindow,
  ParsedWorkbook,
  ParsedWorksheet,
} from '../../../desktop/metadata/types.js';
import { validateNotionalSpecArgs } from '../../../desktop/notionalSpecGuard.js';
import { validateCommandParams } from '../../../desktop/paramContractGuard.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import type { ToolExecutor } from '../../../desktop/toolExecutor/toolExecutor.js';
import { validateUnderlyingMetadataLoad } from '../../../desktop/underlyingMetadataGuard.js';
import { ArgsValidationError, DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const LOAD_UNDERLYING_METADATA_COMMAND = 'tabui:load-underlying-metadata';
const GENERATE_VIZ_FROM_NOTIONAL_SPEC_COMMAND = 'tabdoc:generate-viz-from-notional-spec';
const KNOWN_LIVE_FAILURE_FIXES = new Map<string, string>([
  [
    'tabdoc:sort-nested',
    'FIX: tabdoc:sort-nested is known to fail (HTTP 500) on current Desktop builds regardless of parameters — do not retry it. Sort instead via the bind-template sort proposal (preferred for template-bound sheets) or the document round-trip (tabui:save-underlying-metadata → edit the computed-sort → tabui:load-underlying-metadata).',
  ],
]);

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  command: z
    .string()
    .describe(
      "Command name: 'namespace:command' (e.g., 'tabdoc:save', 'tabdoc:delete-sheet'). Use search-commands.",
    ),
  args: z.record(z.any()).optional().describe("JSON command args (e.g., { 'Sheet': 'Sheet 1' })."),
};

const title = 'Execute Tableau Command';
export const getExecuteTableauCommandTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'execute-tableau-command',
    title,
    description:
      "Execute an arbitrary registered Tableau Desktop command. Use search-commands to find available commands; a name not in the registry returns command-not-found. Commands use the format 'namespace:command' (e.g., 'tabdoc:save', 'tabdoc:delete-sheet').",
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async ({ session, command, args }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { session, command, args },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;

          const parts = command.split(':');
          if (parts.length !== 2) {
            return new ArgsValidationError(
              `Invalid command format. Expected 'namespace:command' (e.g., 'tabdoc:goto-sheet'), got: ${command}`,
            ).toErr();
          }

          const [namespace, cmd] = parts as ['tabui' | 'tabdoc', string];
          if (namespace !== 'tabui' && namespace !== 'tabdoc') {
            return new ArgsValidationError(
              `Invalid namespace "${namespace}". Expected 'tabui' or 'tabdoc'.`,
            ).toErr();
          }

          const commandValidation = validateKnownCommand(command);
          if (!commandValidation.ok) {
            return new ArgsValidationError(commandValidation.message).toErr();
          }

          // Generic param-contract guard: runs after the verb is confirmed known,
          // before the deeper NotionalSpec payload guard. Fails open on commands
          // with zero declared "in" params so the two never contradict.
          const paramValidation = validateCommandParams(command, args);
          if (!paramValidation.ok) {
            return new ArgsValidationError(paramValidation.message).toErr();
          }

          const notionalSpecValidation = validateNotionalSpecArgs(command, args);
          if (!notionalSpecValidation.ok) {
            return new ArgsValidationError(notionalSpecValidation.message).toErr();
          }

          const executor = await extra.getExecutor(resolvedSession);
          if (command === LOAD_UNDERLYING_METADATA_COMMAND) {
            let liveDocumentXml: string | null = null;
            try {
              const liveDocumentResult = await executor.executeCommand({
                namespace: 'tabui',
                command: 'save-underlying-metadata',
                args: {},
                signal: extra.signal,
              });
              if (!liveDocumentResult.isErr()) {
                liveDocumentXml = extractDocumentText(liveDocumentResult.value);
              }
            } catch {
              liveDocumentXml = null;
            }

            const loadValidation = validateUnderlyingMetadataLoad(
              typeof args?.text === 'string' ? args.text : '',
              liveDocumentXml,
            );
            if (!loadValidation.ok) {
              return new ArgsValidationError(loadValidation.message).toErr();
            }
          }

          const result = await executor.executeCommand({
            namespace,
            command: cmd,
            args: args ?? {},
            signal: extra.signal,
          });

          if (result.isErr()) {
            return new DesktopCommandExecutionError(
              result.error,
              KNOWN_LIVE_FAILURE_FIXES.get(command),
            ).toErr();
          }

          const resultText = result.value.result
            ? JSON.stringify(result.value.result, null, 2)
            : 'Command completed successfully (no result data)';
          let message = `Command executed successfully:\n\n${resultText}`;
          if (command === GENERATE_VIZ_FROM_NOTIONAL_SPEC_COMMAND) {
            message = await appendGenerateVizReadback({ message, executor, signal: extra.signal });
          }

          return new Ok({
            message,
          });
        },
      });
    },
  });

  return tool;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractDocumentText(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const parsedResult = value.parsedResult;
  if (isRecord(parsedResult) && typeof parsedResult.text === 'string') {
    return parsedResult.text;
  }

  const result = value.result;
  if (isRecord(result) && typeof result.text === 'string') {
    return result.text;
  }

  return typeof result === 'string' ? result : null;
}

async function appendGenerateVizReadback({
  message,
  executor,
  signal,
}: {
  message: string;
  executor: ToolExecutor;
  signal: AbortSignal;
}): Promise<string> {
  try {
    const workbookXml = await getWorkbookXml({ executor, signal });
    if (workbookXml.isErr()) {
      return message;
    }
    const readback = formatCurrentWorksheetReadback(workbookXml.value);
    return readback ? `${message}\n\n${readback}` : message;
  } catch {
    return message;
  }
}

function formatCurrentWorksheetReadback(workbookXml: string): string | null {
  const workbook = parseXML(workbookXml);
  const worksheet = pickCurrentWorksheet(workbook);
  if (!worksheet) {
    return null;
  }

  const rows = formatShelf(worksheet.table?.rows);
  const cols = formatShelf(worksheet.table?.cols);
  const markClass = getMarkClass(worksheet);
  const sort = getSortSummary(worksheet);
  const pieces = [
    `readback: sheet "${worksheet['@_name']}" - Rows: ${rows}; Cols: ${cols}`,
    markClass ? `mark: ${markClass}` : undefined,
    sort ? `sort: ${sort}` : undefined,
  ].filter(Boolean);

  return `${pieces.join('; ')}.`;
}

function pickCurrentWorksheet(workbook: ParsedWorkbook): ParsedWorksheet | null {
  const worksheets = findAllWorksheets(workbook);
  if (worksheets.length === 0) {
    return null;
  }

  const worksheetWindows = normalizeArray<ParsedWindow>(workbook.workbook?.windows?.window).filter(
    (window) => (window['@_class'] ?? 'worksheet') === 'worksheet',
  );
  const activeWindow = worksheetWindows.find((window) =>
    ['true', '1'].includes(String(window['@_active'] ?? '').toLowerCase()),
  );
  if (activeWindow?.['@_name']) {
    return findWorksheet(workbook, activeWindow['@_name']);
  }

  const maximizedWindow = worksheetWindows.find((window) =>
    ['true', '1'].includes(String(window['@_maximized'] ?? '').toLowerCase()),
  );
  if (maximizedWindow?.['@_name']) {
    return findWorksheet(workbook, maximizedWindow['@_name']);
  }

  if (worksheets.length === 1) {
    return worksheets[0];
  }
  if (worksheetWindows.length === 1 && worksheetWindows[0]['@_name']) {
    return findWorksheet(workbook, worksheetWindows[0]['@_name']);
  }

  return null;
}

function formatShelf(value: unknown): string {
  const parts = normalizeArray(value)
    .map((entry) => textValue(entry))
    .filter((entry): entry is string => Boolean(entry));
  return parts.length > 0 ? parts.join(', ') : '[]';
}

function getMarkClass(worksheet: ParsedWorksheet): string | null {
  const panes = normalizeArray<ParsedPane>(worksheet.table?.panes?.pane);
  const paneWithMark = panes.find((pane) => typeof pane.mark?.['@_class'] === 'string');
  return paneWithMark?.mark?.['@_class'] ?? null;
}

function getSortSummary(worksheet: ParsedWorksheet): string | null {
  const sort = findFirstSort(worksheet.table);
  if (!isRecord(sort)) {
    return null;
  }

  const column = stringAttr(sort, '@_column');
  const direction = stringAttr(sort, '@_direction')?.toLowerCase();
  const using = stringAttr(sort, '@_using');
  if (!column && !direction && !using) {
    return null;
  }

  return [column, direction, using ? `by ${using}` : undefined].filter(Boolean).join(' ');
}

function findFirstSort(value: unknown): unknown {
  if (!isRecord(value)) {
    return null;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key.toLowerCase().endsWith('sort')) {
      return Array.isArray(child) ? child[0] : child;
    }
  }
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const sort = findFirstSort(item);
        if (sort) return sort;
      }
      continue;
    }
    const sort = findFirstSort(child);
    if (sort) return sort;
  }
  return null;
}

function textValue(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (isRecord(value) && typeof value['#text'] === 'string') {
    return value['#text'];
  }
  return null;
}

function stringAttr(value: Record<string, unknown>, key: string): string | null {
  const attr = value[key];
  return typeof attr === 'string' && attr.length > 0 ? attr : null;
}
