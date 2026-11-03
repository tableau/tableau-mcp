import { Ok, Result } from 'ts-results-es';

import { resolveItemByNameOrId } from '../../../desktop/externalApi/toolUtils.js';
import { DatasourceItem } from '../../../desktop/externalApi/types.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { ArgsValidationError } from '../../../errors/mcpToolError.js';

export type ResolvedDatasourceRef = {
  id: string;
  name: string;
  caption: string;
  resolvedSession: string;
};

type ListedDatasource = DatasourceItem & { id: string; name: string };

/** Resolve a datasource id, internal name, or caption against the open workbook. */
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
        (datasource): datasource is ListedDatasource =>
          typeof datasource.id === 'string' && typeof datasource.name === 'string',
      );
      const resolved = resolveDatasource(datasourceName, candidates);
      if (resolved.isErr()) {
        return resolved.error.toErr();
      }

      return new Ok({
        id: resolved.value.id,
        name: resolved.value.name,
        caption: resolved.value.caption ?? resolved.value.name,
        resolvedSession,
      });
    },
  });
}

function resolveDatasource(
  requested: string,
  candidates: ListedDatasource[],
): Result<ListedDatasource, ArgsValidationError> {
  const resolved = resolveItemByNameOrId('Datasource', requested, candidates);
  const trimmed = requested.trim();
  if (resolved.isOk() || candidates.some((datasource) => datasource.name === trimmed)) {
    return resolved;
  }

  const captionMatches = candidates.filter((datasource) => datasource.caption === trimmed);
  if (captionMatches.length === 1) {
    return new Ok(captionMatches[0]);
  }
  if (captionMatches.length > 1) {
    return new ArgsValidationError(
      `Datasource "${requested}" matched multiple datasources by caption. Specify one id: ${captionMatches
        .map((datasource) => `${datasource.name} (${datasource.id})`)
        .join(', ')}`,
    ).toErr();
  }
  return resolved;
}
