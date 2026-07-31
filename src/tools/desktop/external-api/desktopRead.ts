import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { listDashboards } from '../../../desktop/commands/workbook/listDashboards.js';
import { listWorksheets } from '../../../desktop/commands/workbook/listWorksheets.js';
import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import { DatasourceItem, SiteDatasourceItem } from '../../../desktop/externalApi/types.js';
import { ExecuteCommandError } from '../../../desktop/toolExecutor/toolExecutor.js';
import { ArgsValidationError, McpToolError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { ExternalApiRead, runExternalApiReadTool } from '../externalApiReadHarness.js';
import { DesktopTool } from '../tool.js';
import { resolveItemByNameOrId } from './externalApiToolUtils.js';

type ReadRun = (ctx: {
  target: string | undefined;
  read: ExternalApiRead;
}) => Promise<Result<unknown, McpToolError>>;

const READERS: Record<string, ReadRun> = {
  health: ({ read }) => read('health', (e, signal) => e.health(signal)),
  'api-root': ({ read }) => read('API root', (e, signal) => e.getRoot(signal)),
  'app-info': ({ read }) => read('app info', (e, signal) => e.getApp(signal)),
  site: ({ read }) => read('site', (e, signal) => e.getSite(signal)),
  'site-workbooks': ({ read }) =>
    read('site workbooks', (e, signal) => e.listSiteWorkbooks(signal)),
  storyboards: ({ read }) => read('storyboard list', (e, signal) => e.listStoryboards(signal)),
  // Route through the command-layer list functions, not the raw executor: they carry the
  // WorkbookReadGateway fallback that derives names from the whole-workbook document when the
  // typed list route 404s. Calling the executor directly would drop that fallback.
  worksheets: ({ read }) =>
    read('worksheet list', (executor, signal) => listWorksheets({ executor, signal })),
  dashboards: ({ read }) =>
    read('dashboard list', (executor, signal) => listDashboards({ executor, signal })),
  inventory: async ({ read }) => {
    const result = await read('workbook inventory', (e, signal) => e.getWorkbook(signal));
    if (result.isErr()) {
      return result;
    }
    const wb = result.value;
    return new Ok({
      title: wb.title,
      ...(wb.location !== undefined ? { location: wb.location } : {}),
      unsavedChanges: wb.unsavedChanges,
      worksheets: wb.worksheets ?? [],
      dashboards: wb.dashboards ?? [],
      storyboards: wb.storyboards ?? [],
    });
  },
  'workbook-datasources': async ({ read }) => {
    const result = await read('workbook datasources', (e, signal) =>
      e.listWorkbookDatasources(signal),
    );
    if (result.isErr()) {
      return result;
    }
    return new Ok({
      datasources: (result.value.datasources ?? []).map(projectWorkbookDatasource),
    });
  },
  'site-datasources': async ({ read }) => {
    const result = await read('site datasources', (e, signal) => e.listSiteDatasources(signal));
    if (result.isErr()) {
      return result;
    }
    return new Ok({
      datasources: (result.value.datasources ?? []).map(projectSiteDatasource),
    });
  },
  'worksheet-info': ({ target, read }) =>
    readItem(target, 'Worksheet', read, {
      listLabel: 'worksheet list',
      list: (e, signal) => e.listWorksheets(signal),
      pick: (v) => v.worksheets ?? [],
      metaLabel: 'worksheet metadata',
      meta: (e, id, signal) => e.getWorksheet(id, signal),
    }),
  'dashboard-info': ({ target, read }) =>
    readItem(target, 'Dashboard', read, {
      listLabel: 'dashboard list',
      list: (e, signal) => e.listDashboards(signal),
      pick: (v) => v.dashboards ?? [],
      metaLabel: 'dashboard metadata',
      meta: (e, id, signal) => e.getDashboard(id, signal),
    }),
  'storyboard-info': ({ target, read }) =>
    readItem(target, 'Storyboard', read, {
      listLabel: 'storyboard list',
      list: (e, signal) => e.listStoryboards(signal),
      pick: (v) => v.storyboards ?? [],
      metaLabel: 'storyboard metadata',
      meta: (e, id, signal) => e.getStoryboard(id, signal),
    }),
  'storyboard-document': ({ target, read }) =>
    readItem(target, 'Storyboard', read, {
      listLabel: 'storyboard list',
      list: (e, signal) => e.listStoryboards(signal),
      pick: (v) => v.storyboards ?? [],
      metaLabel: 'storyboard document',
      meta: (e, id, signal) => e.getStoryboardDocument(id, signal),
    }),
};

const methods = Object.keys(READERS) as [string, ...string[]];

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  method: z.enum(methods).describe('Which read to run.'),
  target: z
    .string()
    .optional()
    .describe('Name or id for the item-scoped reads (worksheet-info/dashboard-info/storyboard-*).'),
};

const title = 'Read Tableau';
export const getDesktopReadTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const desktopRead = new DesktopTool({
    server,
    name: 'desktop-read',
    title,
    description:
      'Read Tableau Desktop state: worksheets/dashboards/storyboards lists, workbook inventory, ' +
      'workbook/site datasources, site, app-info, health, api-root, and one ' +
      'worksheet/dashboard/storyboard by name or id (pass target).',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session, method, target }, extra): Promise<CallToolResult> => {
      return await desktopRead.logAndExecute({
        extra,
        args: { session, method, target },
        callback: async () =>
          await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) => await READERS[method]({ target, read }),
          }),
      });
    },
  });

  return desktopRead;
};

function projectWorkbookDatasource(datasource: DatasourceItem): {
  id?: string;
  luid?: string;
  name?: string;
  caption?: string;
} {
  return {
    ...(datasource.id !== undefined ? { id: datasource.id } : {}),
    // The API emits luid: null for embedded/federated datasources; only surface a real LUID.
    ...(typeof datasource.luid === 'string' ? { luid: datasource.luid } : {}),
    ...(datasource.name !== undefined ? { name: datasource.name } : {}),
    ...(datasource.caption !== undefined ? { caption: datasource.caption } : {}),
  };
}

function projectSiteDatasource(datasource: SiteDatasourceItem): {
  id?: string;
  luid?: string;
  name?: string;
  contentUrl?: string;
} {
  const contentUrl = (datasource as Record<string, unknown>)['contentUrl'];
  return {
    ...(datasource.id !== undefined ? { id: datasource.id } : {}),
    ...(datasource.luid !== undefined ? { luid: datasource.luid } : {}),
    ...(datasource.name !== undefined ? { name: datasource.name } : {}),
    ...(typeof contentUrl === 'string' ? { contentUrl } : {}),
  };
}

async function readItem<TItem extends { id: string; name: string }, TList, TMeta>(
  target: string | undefined,
  kind: string,
  read: ExternalApiRead,
  ops: {
    listLabel: string;
    list: (
      executor: ExternalApiToolExecutor,
      signal: AbortSignal,
    ) => Promise<Result<TList, ExecuteCommandError>>;
    pick: (list: TList) => TItem[];
    metaLabel: string;
    meta: (
      executor: ExternalApiToolExecutor,
      id: string,
      signal: AbortSignal,
    ) => Promise<Result<TMeta, ExecuteCommandError>>;
  },
): Promise<Result<unknown, McpToolError>> {
  if (target === undefined || target.trim() === '') {
    return new ArgsValidationError(`${kind} read requires a target (name or id).`).toErr();
  }

  const listResult = await read(ops.listLabel, ops.list);
  if (listResult.isErr()) {
    return listResult;
  }

  const resolved = resolveItemByNameOrId(kind, target, ops.pick(listResult.value));
  if (resolved.isErr()) {
    return resolved.error.toErr();
  }

  return await read(ops.metaLabel, (executor, signal) =>
    ops.meta(executor, resolved.value.id, signal),
  );
}
