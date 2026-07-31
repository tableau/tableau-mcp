import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Result } from 'ts-results-es';
import { z } from 'zod';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import { ExecuteCommandError } from '../../../desktop/toolExecutor/toolExecutor.js';
import { ArgsValidationError, McpToolError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { ExternalApiRead, runExternalApiReadTool } from '../externalApiReadHarness.js';
import { DesktopTool } from '../tool.js';
import { resolveItemByNameOrId } from './externalApiToolUtils.js';

type ReadRun = (
  target: string | undefined,
  read: ExternalApiRead,
) => Promise<Result<unknown, McpToolError>>;

const READERS: Record<string, ReadRun> = {
  health: (_target, read) => read('health', (e, signal) => e.health(signal)),
  'api-root': (_target, read) => read('API root', (e, signal) => e.getRoot(signal)),
  'app-info': (_target, read) => read('app info', (e, signal) => e.getApp(signal)),
  site: (_target, read) => read('site', (e, signal) => e.getSite(signal)),
  'site-workbooks': (_target, read) =>
    read('site workbooks', (e, signal) => e.listSiteWorkbooks(signal)),
  storyboards: (_target, read) => read('storyboard list', (e, signal) => e.listStoryboards(signal)),
  'worksheet-info': (target, read) =>
    readItem(target, 'Worksheet', read, {
      listLabel: 'worksheet list',
      list: (e, signal) => e.listWorksheets(signal),
      pick: (v) => v.worksheets ?? [],
      metaLabel: 'worksheet metadata',
      meta: (e, id, signal) => e.getWorksheet(id, signal),
    }),
  'dashboard-info': (target, read) =>
    readItem(target, 'Dashboard', read, {
      listLabel: 'dashboard list',
      list: (e, signal) => e.listDashboards(signal),
      pick: (v) => v.dashboards ?? [],
      metaLabel: 'dashboard metadata',
      meta: (e, id, signal) => e.getDashboard(id, signal),
    }),
  'storyboard-info': (target, read) =>
    readItem(target, 'Storyboard', read, {
      listLabel: 'storyboard list',
      list: (e, signal) => e.listStoryboards(signal),
      pick: (v) => v.storyboards ?? [],
      metaLabel: 'storyboard metadata',
      meta: (e, id, signal) => e.getStoryboard(id, signal),
    }),
  'storyboard-document': (target, read) =>
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

const title = 'Read Tableau Environment';
export const getDesktopReadTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const desktopRead = new DesktopTool({
    server,
    name: 'desktop-read',
    title,
    description:
      'Read Tableau Desktop environment and structure: health, api-root, app-info, site, ' +
      'site-workbooks, storyboards, and one worksheet/dashboard/storyboard by name or id. ' +
      'Pass target for the item-scoped reads.',
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
            callback: async (_executor, _signal, read) => await READERS[method](target, read),
          }),
      });
    },
  });

  return desktopRead;
};

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
