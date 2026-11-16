import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Result } from 'ts-results-es';
import { z } from 'zod';

import { ExecuteCommandError } from '../../../desktop/externalApi/executorTypes.js';
import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import {
  DashboardItem,
  SheetKind,
  StoryboardItem,
  WorksheetItem,
} from '../../../desktop/externalApi/types.js';
import { listDashboards } from '../../../desktop/wrappers/listDashboards.js';
import { listWorksheets } from '../../../desktop/wrappers/listWorksheets.js';
import { ExternalApiCall, runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { ArgsValidationError, McpToolError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import { TableauDesktopRequestHandlerExtra } from '../toolContext.js';
import { isSheetNotFound, resolveSheetRef } from './resolveSheetRef.js';

const paramsSchema = {
  session: sessionParam(),
  kind: z
    .enum(['worksheet', 'dashboard', 'storyboard'])
    .optional()
    .describe('Kind to list or read; omit for every sheet.'),
  sheetId: z
    .string()
    .min(1)
    .optional()
    .describe('Id of one sheet to read (needs kind); omit to list the kind.'),
};

const title = 'Get Sheets';

const SHEETS_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export const getSheetsTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const getSheetsTool = new DesktopTool({
    server,
    name: 'get-sheets',
    title,
    description:
      'Without kind: title, unsaved changes, and every sheet. ' +
      "With kind: that kind's sheets with id, name, and state. With sheetId: that one sheet. " +
      'index is the 0-based tab position across all kinds, not list order. ' +
      "A worksheet's datasource list contains its references; an empty list does not mean the workbook has no connected datasource. Use get-datasources only when connection inventory matters. " +
      'Not needed before template discovery or building.',
    paramsSchema,
    annotations: SHEETS_ANNOTATIONS,
    callback: async ({ session, kind, sheetId }, extra): Promise<CallToolResult> => {
      return await getSheetsTool.logAndExecute({
        extra,
        args: { session, kind, sheetId },
        callback: async () => await getSheets({ session, kind, sheetId, extra }),
      });
    },
  });

  return getSheetsTool;
};

async function getSheets({
  session,
  kind,
  sheetId,
  extra,
}: {
  session: string | undefined;
  kind?: SheetKind;
  sheetId?: string;
  extra: TableauDesktopRequestHandlerExtra;
}): Promise<Result<object, McpToolError>> {
  if (kind === undefined) {
    if (sheetId !== undefined) {
      return new ArgsValidationError('kind is required with sheetId.').toErr();
    }
    return await runExternalApiReadTool({
      session,
      extra,
      callback: async (_executor, _signal, read) => await readInventory(read),
    });
  }
  if (sheetId === undefined) {
    return await runExternalApiReadTool({
      session,
      extra,
      callback: async (_executor, _signal, read) => await listSheets(read, kind),
    });
  }
  return await runExternalApiReadTool({
    session,
    extra,
    callback: async (executor, signal, read) => {
      const byId = await getSheetItem(executor, kind, sheetId, signal);
      const readItem = async (
        item: Result<SheetItem, ExecuteCommandError>,
      ): Promise<Result<object, McpToolError>> =>
        (await read(kind, async () => await Promise.resolve(item))).map((value) => ({
          kind,
          ...value,
        }));
      if (byId.isOk() || !isSheetNotFound(byId.error)) {
        return await readItem(byId);
      }
      const resolved = await resolveSheetRef({ session, sheet: sheetId, kind, extra });
      if (resolved.isErr()) {
        return resolved;
      }
      const { id } = resolved.value.ref;
      if (id === sheetId) {
        return await readItem(byId);
      }
      return await readItem(await getSheetItem(executor, kind, id, signal));
    },
  });
}

async function readInventory(read: ExternalApiCall): Promise<Result<object, McpToolError>> {
  const result = await read(
    'workbook inventory',
    async (executor, signal) => await executor.getWorkbook(signal),
  );
  return result.map((workbook) => ({
    title: workbook.title,
    ...(workbook.location !== undefined ? { location: workbook.location } : {}),
    unsavedChanges: workbook.unsavedChanges,
    worksheets: workbook.worksheets ?? [],
    dashboards: workbook.dashboards ?? [],
    storyboards: workbook.storyboards ?? [],
  }));
}

async function listSheets(
  read: ExternalApiCall,
  kind: SheetKind,
): Promise<Result<object, McpToolError>> {
  switch (kind) {
    case 'worksheet':
      return await read(
        'worksheet list',
        async (executor, signal) => await listWorksheets({ executor, signal }),
      );
    case 'dashboard':
      return await read(
        'dashboard list',
        async (executor, signal) => await listDashboards({ executor, signal }),
      );
    case 'storyboard': {
      const result = await read(
        'storyboard list',
        async (executor, signal) => await executor.listStoryboards(signal),
      );
      return result.map((value) => {
        const storyboards = value.storyboards ?? [];
        return { count: storyboards.length, storyboards };
      });
    }
  }
}

type SheetItem = WorksheetItem | DashboardItem | StoryboardItem;

async function getSheetItem(
  executor: ExternalApiToolExecutor,
  kind: SheetKind,
  id: string,
  signal: AbortSignal,
): Promise<Result<SheetItem, ExecuteCommandError>> {
  switch (kind) {
    case 'worksheet':
      return await executor.getWorksheet(id, signal);
    case 'dashboard':
      return await executor.getDashboard(id, signal);
    case 'storyboard':
      return await executor.getStoryboard(id, signal);
  }
}
