import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import {
  externalApiDialogPolicyFor,
  knownLiveFailureFixFor,
} from '../../../desktop/commandPolicy.js';
import { validateKnownCommand } from '../../../desktop/commandRegistry.js';
import { getWorkbookXml } from '../../../desktop/commands/workbook/getWorkbookXml.js';
import {
  ExternalApiCommandRegistryEntry,
  ExternalApiRegistryParam,
  lookupExternalApiCommandRegistry,
} from '../../../desktop/externalApi/commandRegistry.js';
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
const CONTEXT_FILLED_PARAM_TYPES = new Set(['UPI_Workspace', 'UPI_IWorkspace']);

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

          const commandValidation = validateKnownCommand(command);
          if (!commandValidation.ok) {
            return new ArgsValidationError(commandValidation.message).toErr();
          }

          // Unconditional: these hang the UI thread headlessly on EVERY deployment
          // (live-observed dialog-poppers that pass the static safety flags), so the
          // refusal cannot depend on the optional registry being installed.
          const externalApiDialogPolicy = externalApiDialogPolicyFor(command);
          if (externalApiDialogPolicy) {
            return new ArgsValidationError(
              formatExternalApiRefusalMessage({
                command,
                reasons: ['live-observed dialog-popper'],
                fix: externalApiDialogPolicy.fix,
              }),
            ).toErr();
          }

          let dispatchArgs = args ?? {};
          let externalApiRegistryWarnings: string[] = [];
          const externalApiCommandRegistry = lookupExternalApiCommandRegistry(namespace, cmd);
          if (externalApiCommandRegistry) {
            const externalApiGuard = validateExternalApiCommandRegistry({
              command,
              args: dispatchArgs,
              registry: externalApiCommandRegistry,
            });
            if (!externalApiGuard.ok) {
              return new ArgsValidationError(externalApiGuard.message).toErr();
            }
            dispatchArgs = externalApiGuard.args;
            externalApiRegistryWarnings = externalApiGuard.warnings;
          } else {
            // No External-API registry loaded/entry found: preserve today's bundled guard behavior.
            const paramValidation = validateCommandParams(command, args);
            if (!paramValidation.ok) {
              return new ArgsValidationError(paramValidation.message).toErr();
            }
          }

          // The deeper NotionalSpec payload guard still runs after param normalization.
          const notionalSpecValidation = validateNotionalSpecArgs(command, dispatchArgs);
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
            args: dispatchArgs,
            signal: extra.signal,
          });

          if (result.isErr()) {
            return new DesktopCommandExecutionError(
              result.error,
              knownLiveFailureFixFor(command),
            ).toErr();
          }

          const resultText = result.value.result
            ? JSON.stringify(result.value.result, null, 2)
            : 'Command completed successfully (no result data)';
          let message = `Command executed successfully:\n\n${resultText}`;
          if (command === GENERATE_VIZ_FROM_NOTIONAL_SPEC_COMMAND) {
            message = await appendGenerateVizReadback({ message, executor, signal: extra.signal });
          }
          if (externalApiRegistryWarnings.length > 0) {
            message = `${message}\n\n${externalApiRegistryWarnings.join('\n')}`;
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

type ExternalApiGuardResult =
  | { ok: true; args: Record<string, unknown>; warnings: string[] }
  | { ok: false; message: string };

function validateExternalApiCommandRegistry({
  command,
  args,
  registry,
}: {
  command: string;
  args: Record<string, unknown>;
  registry: ExternalApiCommandRegistryEntry;
}): ExternalApiGuardResult {
  const externalApiDialogPolicy = externalApiDialogPolicyFor(command);
  if (externalApiDialogPolicy || !registry.invocable || registry.blockingDialog) {
    const reasons = [
      externalApiDialogPolicy ? 'live-observed dialog-popper' : undefined,
      !registry.invocable ? 'agent_can_invoke=false' : undefined,
      registry.blockingDialog ? 'opens_blocking_dialog=true' : undefined,
    ].filter((reason): reason is string => reason !== undefined);
    return {
      ok: false,
      message: formatExternalApiRefusalMessage({
        command,
        reasons,
        fix: externalApiDialogPolicy?.fix,
      }),
    };
  }

  const providedArgs = isRecord(args) ? args : {};
  const rewrittenArgs: Record<string, unknown> = {};
  const warnings: string[] = [];

  for (const [key, value] of Object.entries(providedArgs)) {
    const param = findExternalApiParam(registry, key);
    if (!param) {
      rewrittenArgs[key] = value;
      warnings.push(
        `WARNING: key "${key}" is not in the command registry - a wrong name surfaces as a bare 500.`,
      );
      continue;
    }

    const enumValues = registry.enumValuesForParamType.get(param.type);
    if (enumValues && !enumValues.includes(String(value))) {
      return {
        ok: false,
        message:
          `Invalid value for Tableau command "${command}" parameter "${param.wire}": ` +
          `${JSON.stringify(value)}. Legal values: ${formatLegalValues(enumValues)}.`,
      };
    }

    rewrittenArgs[param.wire] = value;
  }

  const missingRequired = registry.requiredParams.filter(
    (param) => !isContextFilledParam(param) && !hasExternalApiParam(providedArgs, param),
  );
  if (missingRequired.length > 0) {
    return {
      ok: false,
      message:
        `Missing required parameter(s) for Tableau command "${command}": ` +
        `${missingRequired.map((param) => param.wire).join(', ')}. NOT sent. ` +
        'Registry-required UPI_Workspace/UPI_IWorkspace params are context-filled by the active sheet/workspace and are skipped.',
    };
  }

  return { ok: true, args: rewrittenArgs, warnings };
}

function findExternalApiParam(
  registry: ExternalApiCommandRegistryEntry,
  key: string,
): ExternalApiRegistryParam | null {
  return (
    registry.params.find(
      (param) => key === param.local || key === param.camelToDashed || key === param.wire,
    ) ?? null
  );
}

function hasExternalApiParam(
  args: Record<string, unknown>,
  param: ExternalApiRegistryParam,
): boolean {
  return (
    Object.prototype.hasOwnProperty.call(args, param.local) ||
    Object.prototype.hasOwnProperty.call(args, param.camelToDashed) ||
    Object.prototype.hasOwnProperty.call(args, param.wire)
  );
}

function isContextFilledParam(param: ExternalApiRegistryParam): boolean {
  return CONTEXT_FILLED_PARAM_TYPES.has(param.type);
}

function formatExternalApiRefusalMessage({
  command,
  reasons,
  fix,
}: {
  command: string;
  reasons: string[];
  fix?: string;
}): string {
  return (
    `Refusing Tableau command "${command}" because it would open a human-blocking dialog ` +
    `in Tableau Desktop (${reasons.join(', ')}). NOT sent. FIX: ` +
    `${fix ?? 'use a supported headless authoring alternative or ask a human to drive the dialog.'}`
  );
}

function formatLegalValues(values: string[]): string {
  const displayed = values.slice(0, 15);
  const suffix =
    values.length > displayed.length ? `, ... (+${values.length - displayed.length} more)` : '';
  return `${displayed.join(', ')}${suffix}`;
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
