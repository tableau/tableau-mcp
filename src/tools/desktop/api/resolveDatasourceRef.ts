import { Ok } from 'ts-results-es';

import { resolveItemByNameOrId } from '../../../desktop/externalApi/toolUtils.js';
import { DatasourceItem } from '../../../desktop/externalApi/types.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';

export type ResolvedDatasourceRef = {
  id: string;
  name: string;
  resolvedSession: string;
};

/** Resolve a datasource name or encoded inventory id against the open workbook. */
export async function resolveDatasourceRef({
  session,
  datasourceName,
  extra,
}: {
  session: string | undefined;
  datasourceName: string;
  extra: Parameters<typeof runExternalApiReadTool>[0]['extra'];
}): ReturnType<typeof runExternalApiReadTool<ResolvedDatasourceRef>> {
  return await runExternalApiReadTool<ResolvedDatasourceRef>({
    session,
    extra,
    callback: async (_executor, _signal, read, resolvedSession) => {
      const inventory = await read(
        'workbook datasources',
        async (executor, signal) => await executor.listWorkbookDatasources(signal),
      );
      if (inventory.isErr()) {
        return inventory;
      }

      const candidates = (inventory.value.datasources ?? []).filter(
        (datasource): datasource is DatasourceItem & { id: string; name: string } =>
          typeof datasource.id === 'string' && typeof datasource.name === 'string',
      );
      const resolved = resolveItemByNameOrId('Datasource', datasourceName, candidates);
      if (resolved.isErr()) {
        return resolved.error.toErr();
      }

      return new Ok({
        id: resolved.value.id,
        name: resolved.value.name,
        resolvedSession,
      });
    },
  });
}
