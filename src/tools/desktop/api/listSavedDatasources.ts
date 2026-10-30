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
            repositoryLocation ? findSavedDatasources(repositoryLocation) : []
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

function findSavedDatasources(repositoryLocation: string): SavedDatasource[] {
  const folders = [DATASOURCES_FOLDER, ...safeReadDir(repositoryLocation).filter(isNotDefault)];
  for (const folder of folders) {
    const root = join(repositoryLocation, folder);
    if (!isDirectory(root)) continue;
    const found = collect(root, root, 0);
    // The folder name is localized, so when "Datasources" is absent accept the first folder with sources.
    if (found.length > 0) {
      return found.sort(
        (a, b) => Number(a.builtInSample) - Number(b.builtInSample) || a.name.localeCompare(b.name),
      );
    }
  }
  return [];
}

function isNotDefault(folder: string): boolean {
  return folder !== DATASOURCES_FOLDER;
}

function collect(root: string, dir: string, depth: number): SavedDatasource[] {
  const found: SavedDatasource[] = [];
  for (const entry of safeReadDir(dir)) {
    const path = join(dir, entry);
    if (isDirectory(path)) {
      if (depth < MAX_DEPTH) found.push(...collect(root, path, depth + 1));
      continue;
    }
    const ext = extname(entry).toLowerCase();
    if (ext === '.tds' || ext === '.tdsx') {
      found.push({
        name: entry.slice(0, -ext.length),
        path,
        fileType: ext === '.tds' ? 'tds' : 'tdsx',
        builtInSample: relative(root, dir).split(sep).filter(Boolean).length >= 2,
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
