import { Ok, Result } from 'ts-results-es';

import { ExecuteCommandError } from '../../../desktop/externalApi/executorTypes.js';
import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import { resolveItemByNameOrId } from '../../../desktop/externalApi/toolUtils.js';
import { SheetKind, SheetRef } from '../../../desktop/externalApi/types.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.desktop.js';
import { McpToolError } from '../../../errors/mcpToolError.js';

export type ResolvedSheetRef = {
  ref: SheetRef;
  previousName: string;
  worksheetCount: number;
};

/**
 * Resolve a sheet name/id against the live worksheet, dashboard, and storyboard inventories,
 * tagging the match with its {@link SheetKind}.
 */
export async function resolveSheetRef({
  session,
  sheet,
  kind,
  extra,
}: {
  session: string | undefined;
  sheet: string;
  kind?: SheetKind;
  extra: Parameters<typeof runExternalApiReadTool>[0]['extra'];
}): ReturnType<typeof runExternalApiReadTool<ResolvedSheetRef>> {
  return await runExternalApiReadTool<ResolvedSheetRef>({
    session,
    extra,
    callback: async (_executor, _signal, read) => {
      const worksheets = await read(
        'worksheet list',
        async (executor, signal) => await executor.listWorksheets(signal),
      );
      if (worksheets.isErr()) {
        return worksheets;
      }
      const dashboards = await read(
        'dashboard list',
        async (executor, signal) => await executor.listDashboards(signal),
      );
      if (dashboards.isErr()) {
        return dashboards;
      }
      const storyboards = await read(
        'storyboard list',
        async (executor, signal) => await executor.listStoryboards(signal),
      );
      if (storyboards.isErr()) {
        return storyboards;
      }

      const worksheetItems = worksheets.value.worksheets ?? [];
      const tagged: Array<{ id: string; name: string; kind: SheetKind }> = [
        ...worksheetItems.map((w) => ({ id: w.id, name: w.name, kind: 'worksheet' as const })),
        ...(dashboards.value.dashboards ?? []).map((d) => ({
          id: d.id,
          name: d.name,
          kind: 'dashboard' as const,
        })),
        ...(storyboards.value.storyboards ?? []).map((s) => ({
          id: s.id,
          name: s.name,
          kind: 'storyboard' as const,
        })),
      ];

      const resolved = resolveItemByNameOrId(
        'Sheet',
        sheet,
        kind ? tagged.filter((item) => item.kind === kind) : tagged,
      );
      if (resolved.isErr()) {
        return resolved.error.toErr();
      }
      return new Ok({
        ref: { kind: resolved.value.kind, id: resolved.value.id },
        previousName: resolved.value.name,
        worksheetCount: worksheetItems.length,
      });
    },
  });
}

export async function resolveSheetIdOfKind({
  executor,
  kind,
  sheet,
  signal,
}: {
  executor: ExternalApiToolExecutor;
  kind: SheetKind;
  sheet: string;
  signal: AbortSignal;
}): Promise<Result<string, McpToolError>> {
  const list = await listSheetsOfKind(executor, kind, signal);
  if (list.isErr()) {
    return new DesktopCommandExecutionError(list.error).toErr();
  }
  return resolveItemByNameOrId(SHEET_LABEL[kind], sheet, list.value).map((item) => item.id);
}

const SHEET_LABEL: Record<SheetKind, string> = {
  worksheet: 'Worksheet',
  dashboard: 'Dashboard',
  storyboard: 'Storyboard',
};

async function listSheetsOfKind(
  executor: ExternalApiToolExecutor,
  kind: SheetKind,
  signal: AbortSignal,
): Promise<Result<Array<{ id: string; name: string }>, ExecuteCommandError>> {
  switch (kind) {
    case 'worksheet':
      return (await executor.listWorksheets(signal)).map((list) => list.worksheets ?? []);
    case 'dashboard':
      return (await executor.listDashboards(signal)).map((list) => list.dashboards ?? []);
    case 'storyboard':
      return (await executor.listStoryboards(signal)).map((list) => list.storyboards ?? []);
  }
}
