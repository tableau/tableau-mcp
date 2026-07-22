import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { withApplyLock } from '../../../desktop/commands/workbook/applyMutex.js';
import { getWorkbookXml } from '../../../desktop/commands/workbook/getWorkbookXml.js';
import {
  applyWorkbookText,
  type LoadWorkbookXmlError,
} from '../../../desktop/commands/workbook/loadWorkbookXml.js';
import { normalizeArray, parseXML, serializeXML } from '../../../desktop/metadata/parser.js';
import type {
  ParsedDashboard,
  ParsedWindow,
  ParsedWorkbook,
  ParsedWorksheet,
} from '../../../desktop/metadata/types.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { blockingValidationIssues, runValidation } from '../../../desktop/validation/registry.js';
import { xmlNamesEqual } from '../../../desktop/xmlElement.js';
import {
  DesktopCommandExecutionError,
  McpToolError,
  WorkbookXmlLoadFailedError,
  XmlModificationError,
} from '../../../errors/mcpToolError.js';
import { log } from '../../../logging/logger.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().optional().describe('Optional Tableau Desktop session id.'),
  sheetName: z
    .string()
    .min(1)
    .describe('Worksheet, dashboard, or story sheet name to make active.'),
};

type ActivateSheetResult =
  | { status: 'activated'; xml: string; previousSheet?: string; availableSheets: string[] }
  | { status: 'not-found'; availableSheets: string[] }
  | { status: 'parse-failed'; message: string };

type ActivateSheetToolResult = {
  activated: true;
  sheetName: string;
  message: string;
  previousSheet?: string;
  availableSheets: string[];
};

class ActivateSheetNotFoundError extends McpToolError {
  readonly availableSheets: string[];
  readonly structuredContent: { readonly availableSheets: string[] };

  constructor(sheetName: string, availableSheets: string[]) {
    super({
      type: 'sheet-not-found',
      statusCode: 404,
      message: [
        `Sheet "${sheetName}" was not found in the workbook active-window list.`,
        availableSheets.length > 0
          ? `Available sheets: ${availableSheets.map((name) => `"${name}"`).join(', ')}.`
          : 'The workbook has no activatable sheet windows.',
        'Use list-worksheets or list-dashboards to confirm the current names.',
      ].join(' '),
    });
    this.availableSheets = availableSheets;
    this.structuredContent = { availableSheets };
  }
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function namedWindows(workbook: ParsedWorkbook): ParsedWindow[] {
  return normalizeArray<ParsedWindow>(workbook.workbook?.windows?.window).filter(
    (window) =>
      typeof window['@_name'] === 'string' &&
      ['worksheet', 'dashboard', 'storyboard'].includes(String(window['@_class'])),
  );
}

function availableSheetNames(workbook: ParsedWorkbook): string[] {
  const windowNames = namedWindows(workbook).map((window) => window['@_name']);
  if (windowNames.length > 0) {
    return unique(windowNames);
  }

  const worksheetNames = normalizeArray<ParsedWorksheet>(
    workbook.workbook?.worksheets?.worksheet,
  ).map((worksheet) => worksheet['@_name']);
  const dashboardNames = normalizeArray<ParsedDashboard>(
    workbook.workbook?.dashboards?.dashboard,
  ).map((dashboard) => dashboard['@_name']);
  return unique([...worksheetNames, ...dashboardNames].filter((name): name is string => !!name));
}

export function activateSheetInWorkbook(
  workbookXml: string,
  sheetName: string,
): ActivateSheetResult {
  let workbook: ParsedWorkbook;
  try {
    workbook = parseXML(workbookXml);
  } catch (error) {
    return { status: 'parse-failed', message: getExceptionMessage(error) };
  }

  const windows = namedWindows(workbook);
  const availableSheets = availableSheetNames(workbook);
  const target = windows.find((window) => xmlNamesEqual(window['@_name'], sheetName));
  if (!target) {
    return { status: 'not-found', availableSheets };
  }

  const previousSheet = windows.find(
    (window) => window['@_active'] === 'true' || window['@_maximized'] === 'true',
  )?.['@_name'];

  for (const window of windows) {
    delete window['@_active'];
    delete window['@_maximized'];
  }
  target['@_maximized'] = 'true';
  target['@_active'] = 'true';

  try {
    return { status: 'activated', xml: serializeXML(workbook), previousSheet, availableSheets };
  } catch (error) {
    return { status: 'parse-failed', message: getExceptionMessage(error) };
  }
}

function prepareWorkbookXmlForApply(xml: string): { xml: string; error?: LoadWorkbookXmlError } {
  const trimmedXml = xml.trim();
  if (!trimmedXml || (!trimmedXml.startsWith('<?xml') && !trimmedXml.startsWith('<'))) {
    return { xml: trimmedXml, error: { type: 'invalid-xml' } };
  }

  const validation = runValidation(trimmedXml, 'workbook');
  const blockingIssues = blockingValidationIssues(validation.issues);
  if (blockingIssues.length > 0) {
    log({
      level: 'error',
      message: 'Preflight validation failed - XML not sent to Tableau',
      logger: 'workbookCommands',
      data: blockingIssues,
    });

    return {
      xml: trimmedXml,
      error: { type: 'validation-failed', issues: blockingIssues },
    };
  }

  if (validation.issues.length > 0) {
    log({
      level: 'warning',
      message: 'Preflight validation warnings (continuing)',
      logger: 'workbookCommands',
      data: validation.issues,
    });
  }

  return { xml: trimmedXml };
}

const title = 'Activate';
export const getActivateSheetTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const activateSheetTool = new DesktopTool({
    server,
    name: 'activate-sheet',
    description:
      'Activate a worksheet, dashboard, or story by name and recover from failed GoTo.Sheet navigation by switching the active sheet.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    callback: async ({ session, sheetName }, extra): Promise<CallToolResult> => {
      return await activateSheetTool.logAndExecute<ActivateSheetToolResult>({
        extra,
        args: { session, sheetName },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;
          const executor = await extra.getExecutor(resolvedSession);

          return await withApplyLock(async () => {
            const xmlResult = await getWorkbookXml({ executor, signal: extra.signal });
            if (xmlResult.isErr()) {
              return new DesktopCommandExecutionError(xmlResult.error).toErr();
            }

            const activation = activateSheetInWorkbook(xmlResult.value, sheetName);
            if (activation.status === 'parse-failed') {
              return new XmlModificationError(
                `Could not update the workbook active sheet: ${activation.message}`,
              ).toErr();
            }
            if (activation.status === 'not-found') {
              return new ActivateSheetNotFoundError(sheetName, activation.availableSheets).toErr();
            }

            const preparedXml = prepareWorkbookXmlForApply(activation.xml);
            if (preparedXml.error) {
              return new WorkbookXmlLoadFailedError(preparedXml.error).toErr();
            }

            const applyResult = await applyWorkbookText({
              xml: preparedXml.xml,
              executor,
              signal: extra.signal,
            });
            if (applyResult.isErr()) {
              return new DesktopCommandExecutionError(applyResult.error).toErr();
            }

            return new Ok({
              activated: true,
              sheetName,
              message: `Activated sheet "${sheetName}".`,
              ...(activation.previousSheet ? { previousSheet: activation.previousSheet } : {}),
              availableSheets: activation.availableSheets,
            });
          });
        },
      });
    },
  });

  return activateSheetTool;
};
