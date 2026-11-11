import { Ok, Result } from 'ts-results-es';

import { DatasourceItem } from '../../../desktop/externalApi/types.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { decodeXmlEntities } from '../../../desktop/xmlElement.js';
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
  const trimmed = requested.trim();
  const idMatch = candidates.find((datasource) => datasource.id === trimmed);
  if (idMatch) {
    return new Ok(idMatch);
  }

  const lookups = [...new Set([trimmed, decodeXmlEntities(trimmed)])];
  for (const key of ['name', 'caption'] as const) {
    for (const value of lookups) {
      const matches = candidates.filter((datasource) => datasource[key] === value);
      if (matches.length === 1) {
        return new Ok(matches[0]);
      }
      if (matches.length > 1) {
        return new ArgsValidationError(
          `Datasource "${requested}" matched multiple datasources. Specify one id: ${formatDatasources(matches)}`,
        ).toErr();
      }
    }
  }

  return new ArgsValidationError(
    `Datasource "${requested}" was not found. Available datasources: ${formatDatasources(candidates)}`,
  ).toErr();
}

function formatDatasources(datasources: ListedDatasource[]): string {
  return datasources
    .map((datasource) => `${datasource.caption ?? datasource.name} (${datasource.id})`)
    .join(', ');
}
