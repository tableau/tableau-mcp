import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { knownLiveFailureFixFor } from '../../../desktop/commandPolicy.js';
import { guardCommand } from '../../../desktop/commands/externalApiCommandGuard.js';
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
import { resolveSession } from '../../../desktop/sessionResolution.js';
import type {
  ExecuteCommandWarning,
  ToolExecutor,
} from '../../../desktop/toolExecutor/toolExecutor.js';
import { ArgsValidationError, DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const GENERATE_VIZ_FROM_NOTIONAL_SPEC_COMMAND = 'tabdoc:generate-viz-from-notional-spec';
const MAX_RESULT_BYTES = 16 * 1024;

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  command: z.string().describe('namespace:command; use search-commands.'),
  args: z.record(z.any()).optional().describe('JSON command args.'),
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
      'Execute a registered Tableau Desktop command. Use search-commands first; format namespace:command.',
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

          const commandGuard = guardCommand({ namespace, cmd, command, args });
          if ('refused' in commandGuard) {
            return new ArgsValidationError(commandGuard.message).toErr();
          }
          const { dispatchArgs, warnings: commandGuardWarnings } = commandGuard;

          const executor = await extra.getExecutor(resolvedSession);
          const result = await executor.executeCommand({
            namespace,
            command: cmd,
            args: dispatchArgs,
            signal: extra.signal,
          });

          if (result.isErr()) {
            return new DesktopCommandExecutionError(
              result.error,
              knownLiveFailureFixFor(command),
            ).toErr();
          }

          const payload = shapeCommandResult({
            result: result.value.result,
            envelopeWarnings: result.value.warnings ?? [],
            guardWarnings: commandGuardWarnings,
          });
          if (command === GENERATE_VIZ_FROM_NOTIONAL_SPEC_COMMAND) {
            payload.message = await appendGenerateVizReadback({
              message: payload.message,
              executor,
              signal: extra.signal,
            });
          }

          return new Ok(payload);
        },
      });
    },
  });

  return tool;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

type ExecuteTableauCommandSuccess = {
  message: string;
  result?: Record<string, unknown> | string;
  warnings?: ExecuteCommandWarning[];
};

function shapeCommandResult({
  result,
  envelopeWarnings,
  guardWarnings,
}: {
  result: Record<string, unknown> | null | undefined;
  envelopeWarnings: ExecuteCommandWarning[];
  guardWarnings: string[];
}): ExecuteTableauCommandSuccess {
  const payload: ExecuteTableauCommandSuccess = {
    message: 'Command executed successfully.',
  };

  if (result !== undefined && result !== null) {
    const serialized = JSON.stringify(result, null, 2);
    const totalBytes = Buffer.byteLength(serialized, 'utf-8');
    if (totalBytes > MAX_RESULT_BYTES) {
      const preview = Buffer.from(serialized, 'utf-8').subarray(0, MAX_RESULT_BYTES).toString();
      const previewBytes = Buffer.byteLength(preview, 'utf-8');
      payload.result = `${preview}\n...`;
      payload.message =
        `Command executed successfully. result truncated: ${previewBytes} of ${totalBytes} bytes - ` +
        're-run with a narrower command if you need the rest.';
    } else {
      payload.result = result;
    }
  }

  const warningLines = [
    ...envelopeWarnings.map((warning) => `WARNING: ${warning.code} - ${warning.message}`),
    ...guardWarnings,
  ];
  if (warningLines.length > 0) {
    payload.message = `${payload.message}\n\n${warningLines.join('\n')}`;
  }
  if (envelopeWarnings.length > 0) {
    payload.warnings = envelopeWarnings;
  }

  return payload;
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
