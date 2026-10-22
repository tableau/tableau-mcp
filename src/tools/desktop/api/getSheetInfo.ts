import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { resolveItemByNameOrId } from '../../../desktop/externalApi/toolUtils.js';
import { SheetKind } from '../../../desktop/externalApi/types.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
  sheet: z.string().describe('Worksheet, dashboard, or storyboard name/id.'),
  kind: z
    .enum(['worksheet', 'dashboard', 'storyboard'])
    .optional()
    .describe('Restrict the lookup to one kind. Use when a name is shared across kinds.'),
};

const title = 'Get Sheet Info';

export const getGetSheetInfoTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const getSheetInfoTool = new DesktopTool({
    server,
    name: 'get-sheet-info',
    title,
    description:
      'Reads one worksheet, dashboard, or storyboard by name or id. Returns its id, name, kind, hidden and active state, and index, plus the datasources used for a worksheet, the contained sheets for a dashboard, or the story point count for a storyboard.',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session, sheet, kind }, extra): Promise<CallToolResult> => {
      return await getSheetInfoTool.logAndExecute({
        extra,
        args: { session, sheet, kind },
        callback: async () => {
          return await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) => {
              const tagged: Array<{ id: string; name: string; kind: SheetKind }> = [];

              if (!kind || kind === 'worksheet') {
                const worksheets = await read(
                  'worksheet list',
                  async (executor, signal) => await executor.listWorksheets(signal),
                );
                if (worksheets.isErr()) {
                  return worksheets;
                }
                tagged.push(
                  ...(worksheets.value.worksheets ?? []).map((w) => ({
                    id: w.id,
                    name: w.name,
                    kind: 'worksheet' as const,
                  })),
                );
              }
              if (!kind || kind === 'dashboard') {
                const dashboards = await read(
                  'dashboard list',
                  async (executor, signal) => await executor.listDashboards(signal),
                );
                if (dashboards.isErr()) {
                  return dashboards;
                }
                tagged.push(
                  ...(dashboards.value.dashboards ?? []).map((d) => ({
                    id: d.id,
                    name: d.name,
                    kind: 'dashboard' as const,
                  })),
                );
              }
              if (!kind || kind === 'storyboard') {
                const storyboards = await read(
                  'storyboard list',
                  async (executor, signal) => await executor.listStoryboards(signal),
                );
                if (storyboards.isErr()) {
                  return storyboards;
                }
                tagged.push(
                  ...(storyboards.value.storyboards ?? []).map((s) => ({
                    id: s.id,
                    name: s.name,
                    kind: 'storyboard' as const,
                  })),
                );
              }

              const resolved = resolveItemByNameOrId('Sheet', sheet, tagged);
              if (resolved.isErr()) {
                return resolved.error.toErr();
              }
              const { id, kind: resolvedKind } = resolved.value;

              const item =
                resolvedKind === 'worksheet'
                  ? await read(
                      'worksheet',
                      async (executor, signal) => await executor.getWorksheet(id, signal),
                    )
                  : resolvedKind === 'dashboard'
                    ? await read(
                        'dashboard',
                        async (executor, signal) => await executor.getDashboard(id, signal),
                      )
                    : await read(
                        'storyboard',
                        async (executor, signal) => await executor.getStoryboard(id, signal),
                      );
              if (item.isErr()) {
                return item;
              }
              return new Ok({ kind: resolvedKind, ...item.value });
            },
          });
        },
      });
    },
  });

  return getSheetInfoTool;
};
