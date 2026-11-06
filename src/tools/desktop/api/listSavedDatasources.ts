import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readdirSync, statSync } from 'fs';
import { extname, join, relative, sep } from 'path';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
  nameContains: z
    .string()
    .optional()
    .describe('Case-insensitive substring to filter data source names (e.g. "world").'),
};
const title = 'List Saved Data Sources';

// Desktop copies built-in samples to Datasources/<version>/<locale>/, so allow nesting below that.
const MAX_DEPTH = 4;
const DATASOURCES_FOLDER = 'Datasources';

type SavedDatasource = {
  name: string;
  path: string;
  fileType: 'tds' | 'tdsx';
  builtInSample: boolean;
};

export const getListSavedDatasourcesTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const listSavedDatasourcesTool = new DesktopTool({
    server,
    name: 'list-saved-datasources',
    // Floor matches open-file, the only way to use this tool's output.
    minApiVersion: '0.2.6',
    title,
    description:
      "Lists Tableau Desktop's Saved Data Sources (My Tableau Repository, including bundled " +
      'samples like World Indicators and Sample - Superstore). Connect one by passing its `path` ' +
      'to `open-file`: that keeps its calculations, folders and relationships and resolves its ' +
      'data file.',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session, nameContains }, extra): Promise<CallToolResult> => {
      return await listSavedDatasourcesTool.logAndExecute({
        extra,
        args: { session, nameContains },
        callback: async () => {
          const result = await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) =>
              await read('app', async (executor, signal) => await executor.getApp(signal)),
          });
          if (result.isErr()) {
            return result;
          }

          const repositoryLocation =
            result.value.repositoryLocation || process.env['TABLEAU_REPOSITORY_DIR'] || undefined;
          const needle = nameContains?.toLowerCase();
          const datasources = (
            repositoryLocation ? findSavedDatasources(repositoryLocation, result.value.locale) : []
          ).filter((d) => !needle || d.name.toLowerCase().includes(needle));

          return new Ok({
            repositoryLocation,
            datasources,
            ...(datasources.length === 0
              ? {
                  message:
                    'No saved data sources found' +
                    (repositoryLocation ? ` under "${repositoryLocation}".` : '.'),
                }
              : {}),
          });
        },
      });
    },
  });

  return listSavedDatasourcesTool;
};

// Desktop names the built-in sample folder after the release, e.g. "2026.1".
const VERSION_FOLDER = /^(\d{4})\.(\d+)$/;

type Found = SavedDatasource & { version?: [number, number]; localeFolder?: string };

function findSavedDatasources(repositoryLocation: string, locale?: string): SavedDatasource[] {
  const root = join(repositoryLocation, DATASOURCES_FOLDER);
  // The folder name is localized, so only when "Datasources" is absent accept the first folder with sources.
  const roots = isDirectory(root)
    ? [root]
    : safeReadDir(repositoryLocation)
        .map((folder) => join(repositoryLocation, folder))
        .filter(isDirectory);
  for (const candidate of roots) {
    const found = collect(candidate, candidate, 0);
    if (found.length > 0) return arrange(found, locale);
  }
  return [];
}

// Older releases leave their sample folders behind, so keep only the newest.
function arrange(found: Found[], locale?: string): SavedDatasource[] {
  const user = found.filter((d) => !d.builtInSample);
  let samples = found.filter((d) => d.builtInSample);
  const newest = samples.reduce<[number, number] | undefined>(
    (max, d) => (d.version && (!max || compareVersions(d.version, max) > 0) ? d.version : max),
    undefined,
  );
  samples = samples.filter((d) => d.version && newest && compareVersions(d.version, newest) === 0);

  const wanted = locale?.replace('-', '_').toLowerCase();
  const inLocale = wanted
    ? samples.filter((d) => d.localeFolder?.toLowerCase().startsWith(wanted))
    : [];
  if (inLocale.length > 0) {
    samples = inLocale;
  } else {
    samples = [...new Map(samples.map((d) => [d.name, d])).values()];
  }

  const byName = (a: SavedDatasource, b: SavedDatasource): number => a.name.localeCompare(b.name);
  return [...user.sort(byName), ...samples.sort(byName)].map(
    ({ name, path, fileType, builtInSample }) => ({ name, path, fileType, builtInSample }),
  );
}

function compareVersions(a: [number, number], b: [number, number]): number {
  return a[0] - b[0] || a[1] - b[1];
}

function collect(root: string, dir: string, depth: number): Found[] {
  const found: Found[] = [];
  for (const entry of safeReadDir(dir)) {
    const path = join(dir, entry);
    if (isDirectory(path)) {
      if (depth < MAX_DEPTH) found.push(...collect(root, path, depth + 1));
      continue;
    }
    const ext = extname(entry).toLowerCase();
    if (ext === '.tds' || ext === '.tdsx') {
      const [first, second] = relative(root, dir).split(sep);
      const match = first ? VERSION_FOLDER.exec(first) : null;
      found.push({
        name: entry.slice(0, -ext.length),
        path,
        fileType: ext === '.tds' ? 'tds' : 'tdsx',
        builtInSample: match !== null,
        ...(match ? { version: [Number(match[1]), Number(match[2])], localeFolder: second } : {}),
      });
    }
  }
  return found;
}

function safeReadDir(dir: string): string[] {
  try {
    return existsSync(dir) ? readdirSync(dir) : [];
  } catch {
    return [];
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
