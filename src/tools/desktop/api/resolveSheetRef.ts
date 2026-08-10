import { Ok } from 'ts-results-es';

import { resolveItemByNameOrId } from '../../../desktop/externalApi/toolUtils.js';
import { SheetKind, SheetRef } from '../../../desktop/externalApi/types.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';

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
  extra,
}: {
  session: string | undefined;
  sheet: string;
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

      const resolved = resolveItemByNameOrId('Sheet', sheet, tagged);
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
